<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$id = require_customer();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $stmt = $conn->prepare('SELECT name, email, phone, address, city, province, postal_code FROM customers WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    respond($stmt->get_result()->fetch_assoc() ?: []);
}

if ($method === 'POST') {
    require_csrf();
    $data = json_input();
    $name = trim($data['name'] ?? '');
    $phone = trim($data['phone'] ?? '');
    $address = trim($data['address'] ?? '');
    $city = trim($data['city'] ?? '');
    $province = trim($data['province'] ?? '');
    $postal = trim($data['postal_code'] ?? '');

    if ($name === '') {
        respond(['error' => 'El nombre no puede estar vacío.'], 400);
    }

    $stmt = $conn->prepare('UPDATE customers SET name=?, phone=?, address=?, city=?, province=?, postal_code=? WHERE id=?');
    $stmt->bind_param('ssssssi', $name, $phone, $address, $city, $province, $postal, $id);
    $stmt->execute();

    respond(['ok' => true]);
}

respond(['error' => 'Método no permitido'], 405);
