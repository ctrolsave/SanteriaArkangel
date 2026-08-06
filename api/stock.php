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
    $stmt = $conn->prepare('SELECT type, delta, resulting_stock, note, created_at FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 100');
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
            'createdAt' => $row['created_at'],
        ];
    }
    respond($out);
}

if ($method === 'POST') {
    require_csrf();
    $data = json_input();
    $productId = (int) ($data['productId'] ?? 0);
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

    log_stock_movement($conn, $productId, $type, $qty, $note);
    respond(fetch_all_products($conn));
}

respond(['error' => 'Método no permitido'], 405);
