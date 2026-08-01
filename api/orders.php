<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

function order_with_items($conn, $orderRow) {
    $items = [];
    $stmt = $conn->prepare('SELECT product_name, variant_label, qty, unit_price FROM order_items WHERE order_id = ?');
    $stmt->bind_param('i', $orderRow['id']);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($it = $res->fetch_assoc()) {
        $items[] = [
            'name' => $it['product_name'],
            'label' => $it['variant_label'],
            'qty' => (int) $it['qty'],
            'unitPrice' => (float) $it['unit_price'],
        ];
    }
    return [
        'id' => (int) $orderRow['id'],
        'status' => $orderRow['status'],
        'paymentMethod' => $orderRow['payment_method'],
        'total' => (float) $orderRow['total'],
        'createdAt' => $orderRow['created_at'],
        'trackingCode' => $orderRow['tracking_code'] ?? '',
        'carrier' => $orderRow['carrier'] ?? '',
        'shipping' => json_decode($orderRow['shipping_snapshot'] ?? '{}', true) ?: [],
        'items' => $items,
    ];
}

if ($method === 'GET') {
    $scope = $_GET['scope'] ?? 'mine';

    if ($scope === 'all') {
        require_admin();
        $out = [];
        $res = $conn->query('SELECT o.*, c.name AS customer_name, c.email AS customer_email FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.created_at DESC');
        while ($row = $res->fetch_assoc()) {
            $order = order_with_items($conn, $row);
            $order['customerName'] = $row['customer_name'];
            $order['customerEmail'] = $row['customer_email'];
            $out[] = $order;
        }
        respond($out);
    }

    $customerId = require_customer();
    $out = [];
    $stmt = $conn->prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC');
    $stmt->bind_param('i', $customerId);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $out[] = order_with_items($conn, $row);
    }
    respond($out);
}

if ($method === 'POST') {
    $data = json_input();
    $action = $data['action'] ?? 'create';

    if ($action === 'update_status') {
        require_admin();
        $id = (int) ($data['id'] ?? 0);
        $status = trim($data['status'] ?? '');
        $trackingCode = trim($data['trackingCode'] ?? '');
        $carrier = trim($data['carrier'] ?? '');
        $allowed = ['Pendiente', 'Confirmado', 'Listo para despachar', 'Despachado', 'Entregado', 'Cancelado'];
        if ($id <= 0 || !in_array($status, $allowed, true)) {
            respond(['error' => 'Datos de pedido inválidos.'], 400);
        }
        $stmt = $conn->prepare('UPDATE orders SET status = ?, tracking_code = ?, carrier = ? WHERE id = ?');
        $stmt->bind_param('sssi', $status, $trackingCode, $carrier, $id);
        $stmt->execute();
        respond(['ok' => true]);
    }

    // action === 'create': crea un pedido a partir del carrito del cliente logueado
    $customerId = require_customer();
    $items = $data['items'] ?? [];
    $paymentMethod = trim($data['paymentMethod'] ?? 'transferencia');

    if (empty($items)) {
        respond(['error' => 'El carrito está vacío.'], 400);
    }

    $total = 0;
    foreach ($items as $it) {
        $total += (float) ($it['unitPrice'] ?? 0) * (int) ($it['qty'] ?? 0);
    }

    // Descontar stock de forma segura: se bloquean las filas involucradas y se
    // verifica que alcance antes de confirmar nada. Si no alcanza, no se descuenta
    // ni se crea el pedido (y nunca se le informa al cliente cuánto stock queda).
    $conn->begin_transaction();
    try {
        foreach ($items as $it) {
            $productId = (int) ($it['productId'] ?? 0);
            $qty = (int) ($it['qty'] ?? 0);
            if ($productId <= 0 || $qty <= 0) continue;

            $lock = $conn->prepare('SELECT stock FROM products WHERE id = ? FOR UPDATE');
            $lock->bind_param('i', $productId);
            $lock->execute();
            $row = $lock->get_result()->fetch_assoc();
            if (!$row || (int) $row['stock'] < $qty) {
                throw new Exception('stock');
            }
        }
        foreach ($items as $it) {
            $productId = (int) ($it['productId'] ?? 0);
            $qty = (int) ($it['qty'] ?? 0);
            if ($productId <= 0 || $qty <= 0) continue;
            $upd = $conn->prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
            $upd->bind_param('ii', $qty, $productId);
            $upd->execute();
        }
    } catch (Exception $e) {
        $conn->rollback();
        respond(['error' => 'No hay stock suficiente para completar este pedido. Revisá las cantidades e intentá de nuevo.'], 409);
    }

    $cust = $conn->prepare('SELECT name, phone, address, city, province, postal_code FROM customers WHERE id = ?');
    $cust->bind_param('i', $customerId);
    $cust->execute();
    $shipping = json_encode($cust->get_result()->fetch_assoc());

    $stmt = $conn->prepare('INSERT INTO orders (customer_id, status, payment_method, total, shipping_snapshot) VALUES (?, "Pendiente", ?, ?, ?)');
    $stmt->bind_param('isds', $customerId, $paymentMethod, $total, $shipping);
    $stmt->execute();
    $orderId = $conn->insert_id;

    foreach ($items as $it) {
        $name = trim($it['name'] ?? '');
        $label = trim($it['label'] ?? '');
        $qty = (int) ($it['qty'] ?? 1);
        $price = (float) ($it['unitPrice'] ?? 0);
        $stmt = $conn->prepare('INSERT INTO order_items (order_id, product_name, variant_label, qty, unit_price) VALUES (?,?,?,?,?)');
        $stmt->bind_param('issid', $orderId, $name, $label, $qty, $price);
        $stmt->execute();
    }

    $conn->commit();

    $itemsSummary = implode("\n", array_map(function ($it) {
        $label = trim($it['label'] ?? '');
        return '- ' . ($it['qty'] ?? 1) . 'x ' . ($it['name'] ?? '') . ($label ? " ($label)" : '');
    }, $items));
    $custRow = $conn->query('SELECT name FROM customers WHERE id = ' . (int) $customerId)->fetch_assoc();
    notify_new_order($conn, $orderId, $custRow['name'] ?? '', $total, $itemsSummary);

    respond(['ok' => true, 'orderId' => $orderId]);
}

respond(['error' => 'Método no permitido'], 405);
