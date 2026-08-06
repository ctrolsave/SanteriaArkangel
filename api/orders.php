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
        'deliveryMethod' => $orderRow['delivery_method'] ?? 'envio',
        'total' => (float) $orderRow['total'],
        'createdAt' => $orderRow['created_at'],
        'trackingCode' => $orderRow['tracking_code'] ?? '',
        'carrier' => $orderRow['carrier'] ?? '',
        'paymentConfirmed' => (bool) ($orderRow['payment_confirmed'] ?? false),
        'paidAt' => $orderRow['paid_at'] ?? null,
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
    require_csrf();
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

    // Marca (o desmarca) un pedido como pagado. Es independiente del estado de
    // envío para poder archivar pedidos ya cobrados sin importar en qué punto
    // de la logística estén.
    if ($action === 'set_payment') {
        require_admin();
        $id = (int) ($data['id'] ?? 0);
        $paid = !empty($data['paid']);
        if ($id <= 0) {
            respond(['error' => 'Datos de pedido inválidos.'], 400);
        }
        if ($paid) {
            $stmt = $conn->prepare('UPDATE orders SET payment_confirmed = 1, paid_at = NOW() WHERE id = ?');
        } else {
            $stmt = $conn->prepare('UPDATE orders SET payment_confirmed = 0, paid_at = NULL WHERE id = ?');
        }
        $stmt->bind_param('i', $id);
        $stmt->execute();
        respond(['ok' => true]);
    }

    // action === 'create': crea un pedido a partir del carrito del cliente logueado
    $customerId = require_customer();
    $items = $data['items'] ?? [];
    $paymentMethod = trim($data['paymentMethod'] ?? 'transferencia');
    $deliveryMethod = in_array($data['deliveryMethod'] ?? '', ['envio', 'retiro'], true) ? $data['deliveryMethod'] : 'envio';

    if (empty($items)) {
        respond(['error' => 'El carrito está vacío.'], 400);
    }

    // El nombre, la variante y el precio de cada línea se recalculan acá a partir
    // del catálogo real — nunca se confía en esos datos si vienen del cliente,
    // para que no se pueda manipular el precio de un pedido desde el navegador.
    $catalog = [];
    foreach (fetch_all_products($conn) as $p) {
        $catalog[$p['id']] = $p;
    }

    $resolved = [];
    foreach ($items as $it) {
        $productId = (int) ($it['productId'] ?? 0);
        $qty = (int) ($it['qty'] ?? 0);
        if ($productId <= 0 || $qty <= 0 || !isset($catalog[$productId])) continue;

        $product = $catalog[$productId];
        $selection = is_array($it['selection'] ?? null) ? $it['selection'] : [];
        $activeTiers = resolve_tiers_for_selection($product, $selection);
        $unitPrice = price_for_qty(effective_tiers($product, $activeTiers), $qty);

        $resolved[] = [
            'productId' => $productId,
            'qty' => $qty,
            'name' => $product['name'],
            'label' => options_label($product, $selection),
            'unitPrice' => $unitPrice,
            // Si el producto tiene variantes, cada opción elegida tiene su
            // propio stock (ver resolve_selected_options); si no, se usa el
            // stock general del producto.
            'selectedOptions' => resolve_selected_options($product, $selection),
        ];
    }

    if (empty($resolved)) {
        respond(['error' => 'El carrito está vacío.'], 400);
    }

    $total = 0;
    foreach ($resolved as $it) {
        $total += $it['unitPrice'] * $it['qty'];
    }

    // Descontar stock de forma segura: se bloquean las filas involucradas y se
    // verifica que alcance antes de confirmar nada. Si no alcanza, no se descuenta
    // ni se crea el pedido (y nunca se le informa al cliente cuánto stock queda).
    $conn->begin_transaction();
    try {
        foreach ($resolved as $it) {
            if (!empty($it['selectedOptions'])) {
                foreach ($it['selectedOptions'] as $opt) {
                    $lock = $conn->prepare('SELECT stock FROM variant_options WHERE id = ? FOR UPDATE');
                    $lock->bind_param('i', $opt['id']);
                    $lock->execute();
                    $row = $lock->get_result()->fetch_assoc();
                    if (!$row || (int) $row['stock'] < $it['qty']) {
                        throw new Exception('stock');
                    }
                }
            } else {
                $lock = $conn->prepare('SELECT stock FROM products WHERE id = ? FOR UPDATE');
                $lock->bind_param('i', $it['productId']);
                $lock->execute();
                $row = $lock->get_result()->fetch_assoc();
                if (!$row || (int) $row['stock'] < $it['qty']) {
                    throw new Exception('stock');
                }
            }
        }
        foreach ($resolved as $it) {
            if (!empty($it['selectedOptions'])) {
                foreach ($it['selectedOptions'] as $opt) {
                    log_stock_movement($conn, $it['productId'], 'venta', -$it['qty'], 'Venta', $opt['id']);
                }
            } else {
                log_stock_movement($conn, $it['productId'], 'venta', -$it['qty'], 'Venta');
            }
        }
    } catch (Exception $e) {
        $conn->rollback();
        respond(['error' => 'No hay stock suficiente para completar este pedido. Revisá las cantidades e intentá de nuevo.'], 409);
    }

    $cust = $conn->prepare('SELECT name, phone, address, city, province, postal_code FROM customers WHERE id = ?');
    $cust->bind_param('i', $customerId);
    $cust->execute();
    $shipping = json_encode($cust->get_result()->fetch_assoc());

    $stmt = $conn->prepare('INSERT INTO orders (customer_id, status, payment_method, delivery_method, total, shipping_snapshot) VALUES (?, "Pendiente", ?, ?, ?, ?)');
    $stmt->bind_param('issds', $customerId, $paymentMethod, $deliveryMethod, $total, $shipping);
    $stmt->execute();
    $orderId = $conn->insert_id;

    foreach ($resolved as $it) {
        $stmt = $conn->prepare('INSERT INTO order_items (order_id, product_name, variant_label, qty, unit_price) VALUES (?,?,?,?,?)');
        $stmt->bind_param('issid', $orderId, $it['name'], $it['label'], $it['qty'], $it['unitPrice']);
        $stmt->execute();
    }

    $conn->commit();

    $itemsSummary = implode("\n", array_map(function ($it) {
        return '- ' . $it['qty'] . 'x ' . $it['name'] . ($it['label'] ? " ({$it['label']})" : '');
    }, $resolved));
    $custRow = $conn->query('SELECT name FROM customers WHERE id = ' . (int) $customerId)->fetch_assoc();
    notify_new_order($conn, $orderId, $custRow['name'] ?? '', $total, $itemsSummary, $deliveryMethod);

    respond(['ok' => true, 'orderId' => $orderId]);
}

respond(['error' => 'Método no permitido'], 405);
