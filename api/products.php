<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    respond(fetch_all_products($conn));
}

if ($method === 'POST') {
    require_csrf();
    require_admin();
    $action = $_POST['action'] ?? 'save';

    if ($action === 'delete') {
        $id = (int) ($_POST['id'] ?? 0);
        if ($id > 0) {
            $stmt = $conn->prepare('DELETE FROM products WHERE id = ?');
            $stmt->bind_param('i', $id);
            $stmt->execute();
        }
        respond(fetch_all_products($conn));
    }

    // Reordena productos (drag & drop en el panel): recibe los ids en el
    // orden deseado (de arriba hacia abajo) y les asigna sort_order
    // descendente. Los productos que no vengan en la lista (por ejemplo
    // uno cargado por otro admin justo en ese momento) no se tocan.
    if ($action === 'reorder') {
        $ids = json_decode($_POST['ids'] ?? '[]', true) ?: [];
        $ids = array_values(array_filter(array_map('intval', $ids), fn($v) => $v > 0));
        $total = count($ids);
        $stmt = $conn->prepare('UPDATE products SET sort_order = ? WHERE id = ?');
        foreach ($ids as $i => $id) {
            $order = $total - $i;
            $stmt->bind_param('ii', $order, $id);
            $stmt->execute();
        }
        respond(fetch_all_products($conn));
    }

    // action === 'save' (crea si no viene id, edita si viene id)
    $id = (int) ($_POST['id'] ?? 0);
    $name = trim($_POST['name'] ?? '');
    $category = trim($_POST['category'] ?? 'Otros');
    $description = trim($_POST['description'] ?? '');
    $isOffer = ($_POST['is_offer'] ?? '0') === '1' ? 1 : 0;
    $offerPrice = ($isOffer && isset($_POST['offer_price']) && $_POST['offer_price'] !== '') ? (float) $_POST['offer_price'] : null;
    $stock = max(0, (int) ($_POST['stock'] ?? 0));
    $groups = json_decode($_POST['groups_json'] ?? '[]', true) ?: [];
    // Si el producto tiene variantes, el stock se maneja por opción (más
    // abajo) y el número general del producto queda sin uso: no tiene
    // sentido anotarlo en el historial.
    $hasVariants = !empty(array_filter($groups, fn($g) => trim($g['name'] ?? '') !== ''));

    if ($name === '') {
        respond(['error' => 'El producto necesita un nombre.'], 400);
    }

    $imagePath = handle_image_upload('main_image', 'products', 1000);
    $removeImage = ($_POST['remove_image'] ?? '0') === '1';

    if ($id > 0) {
        // El stock se maneja aparte (log_stock_movement más abajo), para que
        // cada cambio quede registrado en el historial en vez de perderse
        // como un simple pisado de número.
        $oldRow = $conn->prepare('SELECT stock FROM products WHERE id = ?');
        $oldRow->bind_param('i', $id);
        $oldRow->execute();
        $oldStock = (int) ($oldRow->get_result()->fetch_assoc()['stock'] ?? 0);

        $imageSql = $imagePath ? ', image = ?' : ($removeImage ? ", image = ''" : '');
        $sql = "UPDATE products SET name=?, category=?, description=?, is_offer=?, offer_price=? $imageSql WHERE id=?";
        $stmt = $conn->prepare($sql);
        if ($imagePath) {
            $stmt->bind_param('sssidsi', $name, $category, $description, $isOffer, $offerPrice, $imagePath, $id);
        } else {
            $stmt->bind_param('sssidi', $name, $category, $description, $isOffer, $offerPrice, $id);
        }
        $stmt->execute();

        if (!$hasVariants && $stock !== $oldStock) {
            log_stock_movement($conn, $id, 'ajuste', $stock - $oldStock, 'Editado desde el formulario del producto');
        }
    } else {
        $img = $imagePath ?: '';
        // El producto nuevo aparece primero (como hasta ahora): se le asigna
        // el sort_order más alto de la tabla + 1. El stock arranca en 0 y se
        // carga como un ingreso, para que quede en el historial.
        $sortOrder = (int) ($conn->query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products')->fetch_assoc()['m']) + 1;
        $stmt = $conn->prepare('INSERT INTO products (name, category, description, image, is_offer, offer_price, stock, sort_order) VALUES (?,?,?,?,?,?,0,?)');
        $stmt->bind_param('ssssidi', $name, $category, $description, $img, $isOffer, $offerPrice, $sortOrder);
        $stmt->execute();
        $id = $conn->insert_id;

        if (!$hasVariants && $stock > 0) {
            log_stock_movement($conn, $id, 'ingreso', $stock, 'Stock inicial');
        }
    }

    // Escalones de precio: se reemplazan todos en cada guardado
    $conn->query('DELETE FROM price_tiers WHERE product_id = ' . (int) $id);
    $tiers = json_decode($_POST['tiers_json'] ?? '[]', true) ?: [];
    foreach ($tiers as $t) {
        $minQty = max(1, (int) ($t['minQty'] ?? 1));
        $price = (float) ($t['price'] ?? 0);
        $stmt = $conn->prepare('INSERT INTO price_tiers (product_id, min_qty, price) VALUES (?,?,?)');
        $stmt->bind_param('iid', $id, $minQty, $price);
        $stmt->execute();
    }

    // Grupos de variantes y opciones: se reemplazan todos en cada guardado,
    // reutilizando la imagen existente de cada opción si no se subió una nueva.
    $conn->query('DELETE FROM variant_groups WHERE product_id = ' . (int) $id);

    foreach ($groups as $gi => $g) {
        $gname = trim($g['name'] ?? '');
        if ($gname === '') continue;
        $stmt = $conn->prepare('INSERT INTO variant_groups (product_id, name, sort_order) VALUES (?,?,?)');
        $stmt->bind_param('isi', $id, $gname, $gi);
        $stmt->execute();
        $groupId = $conn->insert_id;

        foreach (($g['options'] ?? []) as $oi => $opt) {
            $value = trim($opt['value'] ?? '');
            if ($value === '') continue;
            $tempId = $opt['tempId'] ?? '';
            $uploadedPath = $tempId !== '' ? handle_image_upload('opt_image_' . $tempId, 'options', 700) : null;
            $finalImage = $uploadedPath ?: ($opt['existingImage'] ?? '');
            $optTiers = $opt['tiers'] ?? [];
            $optTiersJson = (is_array($optTiers) && count($optTiers) > 0) ? json_encode($optTiers) : null;
            // El stock de una opción que ya existía se edita aparte, al
            // toque (ver api/stock.php); acá se vuelve a guardar tal cual
            // sin pasar por log_stock_movement (si no, quedaría duplicado).
            // Si la opción es nueva en este guardado, el número que traiga
            // es su stock inicial y sí queda anotado como "ingreso".
            $wasExisting = !empty($opt['id']);
            $optStock = max(0, (int) ($opt['stock'] ?? 0));
            $stmt = $conn->prepare('INSERT INTO variant_options (group_id, value, image, tiers_json, sort_order, stock) VALUES (?,?,?,?,?,?)');
            $insertStock = $wasExisting ? $optStock : 0;
            $stmt->bind_param('isssii', $groupId, $value, $finalImage, $optTiersJson, $oi, $insertStock);
            $stmt->execute();
            $newOptionId = $conn->insert_id;

            if (!$wasExisting && $optStock > 0) {
                log_stock_movement($conn, $id, 'ingreso', $optStock, 'Stock inicial', $newOptionId);
            }
        }
    }

    respond(fetch_all_products($conn));
}

respond(['error' => 'Método no permitido'], 405);
