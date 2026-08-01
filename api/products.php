<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

function fetch_all_products($conn) {
    $products = [];
    $res = $conn->query('SELECT * FROM products ORDER BY created_at DESC');
    while ($p = $res->fetch_assoc()) {
        $pid = (int) $p['id'];

        $tiers = [];
        $tq = $conn->prepare('SELECT min_qty, price FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC');
        $tq->bind_param('i', $pid);
        $tq->execute();
        $tr = $tq->get_result();
        while ($t = $tr->fetch_assoc()) {
            $tiers[] = ['minQty' => (int) $t['min_qty'], 'price' => (float) $t['price']];
        }
        if (empty($tiers)) {
            $tiers[] = ['minQty' => 1, 'price' => 0];
        }

        $groups = [];
        $gq = $conn->prepare('SELECT id, name FROM variant_groups WHERE product_id = ? ORDER BY sort_order ASC, id ASC');
        $gq->bind_param('i', $pid);
        $gq->execute();
        $gr = $gq->get_result();
        while ($g = $gr->fetch_assoc()) {
            $gid = (int) $g['id'];
            $options = [];
            $oq = $conn->prepare('SELECT id, value, image, tiers_json FROM variant_options WHERE group_id = ? ORDER BY sort_order ASC, id ASC');
            $oq->bind_param('i', $gid);
            $oq->execute();
            $or_ = $oq->get_result();
            while ($o = $or_->fetch_assoc()) {
                $optTiers = json_decode($o['tiers_json'] ?? '[]', true);
                $options[] = ['id' => (int) $o['id'], 'value' => $o['value'], 'image' => $o['image'], 'tiers' => is_array($optTiers) ? $optTiers : []];
            }
            $groups[] = ['id' => $gid, 'name' => $g['name'], 'options' => $options];
        }

        $products[] = [
            'id' => $pid,
            'name' => $p['name'],
            'category' => $p['category'],
            'description' => $p['description'],
            'image' => $p['image'],
            'isOffer' => (bool) $p['is_offer'],
            'offerPrice' => $p['offer_price'] !== null ? (float) $p['offer_price'] : null,
            'createdAt' => $p['created_at'],
            'inStock' => ((int) $p['stock']) > 0,
            'stock' => (int) $p['stock'],
            'tiers' => $tiers,
            'variantGroups' => $groups,
        ];
    }
    return $products;
}

if ($method === 'GET') {
    respond(fetch_all_products($conn));
}

if ($method === 'POST') {
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
