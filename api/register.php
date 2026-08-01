<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$data = json_input();
$name = trim($data['name'] ?? '');
$email = strtolower(trim($data['email'] ?? ''));
$pass = (string) ($data['pass'] ?? '');
$phone = trim($data['phone'] ?? '');

if ($name === '' || $email === '' || strlen($pass) < 4) {
    respond(['error' => 'Completá nombre, email y una contraseña de al menos 4 caracteres.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'El email no es válido.'], 400);
}

$check = $conn->prepare('SELECT id FROM customers WHERE email = ?');
$check->bind_param('s', $email);
$check->execute();
if ($check->get_result()->fetch_assoc()) {
    respond(['error' => 'Ya existe una cuenta con ese email.'], 409);
}

$hash = password_hash($pass, PASSWORD_DEFAULT);
$stmt = $conn->prepare('INSERT INTO customers (name, email, password_hash, phone) VALUES (?,?,?,?)');
$stmt->bind_param('ssss', $name, $email, $hash, $phone);
$stmt->execute();

$_SESSION['customer_id'] = $conn->insert_id;
respond(['ok' => true]);
