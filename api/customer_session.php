<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$id = current_customer_id();
if (!$id) {
    respond(['loggedIn' => false]);
}

$stmt = $conn->prepare('SELECT name, email, phone, address, city, province, postal_code FROM customers WHERE id = ?');
$stmt->bind_param('i', $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    respond(['loggedIn' => false]);
}

respond(['loggedIn' => true, 'profile' => $row]);
