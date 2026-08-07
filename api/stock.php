<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_admin();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $productId = (int) ($_GET['product_id'] ?? 0);
    if ($productId <= 0) {
        respond(['error' => 'Falta el producto.'], 400);
    }
    $stmt = $conn->prepare(
        'SELECT sm.type, sm.delta, sm.resulting_stock, sm.note, sm.created_at, vo.value AS option_value
         FROM stock_movements sm
         LEFT JOIN variant_options vo ON vo.id = sm.option_id
         WHERE sm.product_id = ?
         ORDER BY sm.created_at DESC, sm.id DESC LIMIT 100'
    );
    $stmt->bind_param('i', $productId);
    $stmt->execute();
    $res = $stmt->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) {
        $out[] = [
            'type' => $row['type'],
            'delta' => (int) $row['delta'],
            'resultingStock' => (int) $row['resulting_stock'],
            'note' => $row['note'],
            'optionValue' => $row['option_value'],
            'createdAt' => $row['created_at'],
        ];
    }
    respond($out);
}

if ($method === 'POST') {
    require_csrf();
    $data = json_input();
    $productId = (int) ($data['productId'] ?? 0);
    $optionId = !empty($data['optionId']) ? (int) $data['optionId'] : null;
    $qty = (int) ($data['qty'] ?? 0);
    $note = trim($data['note'] ?? '');
    // Por defecto el signo decide (positivo = ingreso, negativo = ajuste),
    // pero quien llama puede forzar el tipo (ej: editar el número a mano
    // siempre es un "ajuste", aunque el número haya subido).
    $allowedTypes = ['ingreso', 'venta', 'ajuste'];
    $type = in_array($data['type'] ?? '', $allowedTypes, true) ? $data['type'] : ($qty > 0 ? 'ingreso' : 'ajuste');

    if ($productId <= 0 || $qty === 0) {
        respond(['error' => 'Cantidad inválida.'], 400);
    }

    $check = $conn->prepare('SELECT id FROM products WHERE id = ?');
    $check->bind_param('i', $productId);
    $check->execute();
    if (!$check->get_result()->fetch_assoc()) {
        respond(['error' => 'El producto no existe.'], 404);
    }

    if ($optionId) {
        // Verificamos que la opción sea realmente de este producto, para
        // que nadie pueda tocar el stock de otro producto pasando un
        // optionId ajeno.
        $optCheck = $conn->prepare(
            'SELECT vo.id FROM variant_options vo JOIN variant_groups vg ON vo.group_id = vg.id WHERE vo.id = ? AND vg.product_id = ?'
        );
        $optCheck->bind_param('ii', $optionId, $productId);
        $optCheck->execute();
        if (!$optCheck->get_result()->fetch_assoc()) {
            respond(['error' => 'Esa opción no pertenece a este producto.'], 400);
        }
    } else {
        // Un producto con variantes no tiene un stock general propio: cada
        // opción tiene el suyo. Si se pide tocar el stock del producto sin
        // pasar optionId, nos aseguramos de que en verdad no tenga variantes.
        $hasGroups = $conn->query('SELECT 1 FROM variant_groups WHERE product_id = ' . (int) $productId . ' LIMIT 1')->fetch_assoc();
        if ($hasGroups) {
            respond(['error' => 'Este producto tiene variantes: el stock se maneja por opción, no en general.'], 400);
        }
    }

    log_stock_movement($conn, $productId, $type, $qty, $note, $optionId);
    respond(fetch_all_products($conn));
}

respond(['error' => 'Método no permitido'], 405);
