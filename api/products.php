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

    // action === 'save' (crea si no viene id, edita si viene id)
    $id = (int) ($_POST['id'] ?? 0);
    $name = trim($_POST['name'] ?? '');
    $category = trim($_POST['category'] ?? 'Otros');
    $description = trim($_POST['description'] ?? '');
    $isOffer = ($_POST['is_offer'] ?? '0') === '1' ? 1 : 0;
    $offerPrice = ($isOffer && isset($_POST['offer_price']) && $_POST['offer_price'] !== '') ? (float) $_POST['offer_price'] : null;
    $stock = max(0, (int) ($_POST['stock'] ?? 0));

    if ($name === '') {
        respond(['error' => 'El producto necesita un nombre.'], 400);
    }

    $imagePath = handle_image_upload('main_image', 'products', 1000);
    $removeImage = ($_POST['remove_image'] ?? '0') === '1';

    if ($id > 0) {
        $imageSql = $imagePath ? ', image = ?' : ($removeImage ? ", image = ''" : '');
        $sql = "UPDATE products SET name=?, category=?, description=?, is_offer=?, offer_price=?, stock=? $imageSql WHERE id=?";
        $stmt = $conn->prepare($sql);
        if ($imagePath) {
            $stmt->bind_param('sssidisi', $name, $category, $description, $isOffer, $offerPrice, $stock, $imagePath, $id);
        } else {
            $stmt->bind_param('sssidii', $name, $category, $description, $isOffer, $offerPrice, $stock, $id);
        }
        $stmt->execute();
    } else {
        $img = $imagePath ?: '';
        $stmt = $conn->prepare('INSERT INTO products (name, category, description, image, is_offer, offer_price, stock) VALUES (?,?,?,?,?,?,?)');
        $stmt->bind_param('ssssidi', $name, $category, $description, $img, $isOffer, $offerPrice, $stock);
        $stmt->execute();
        $id = $conn->insert_id;
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
    $groups = json_decode($_POST['groups_json'] ?? '[]', true) ?: [];
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
            $stmt = $conn->prepare('INSERT INTO variant_options (group_id, value, image, tiers_json, sort_order) VALUES (?,?,?,?,?)');
            $stmt->bind_param('isssi', $groupId, $value, $finalImage, $optTiersJson, $oi);
            $stmt->execute();
        }
    }

    respond(fetch_all_products($conn));
}

respond(['error' => 'Método no permitido'], 405);
