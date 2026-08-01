<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$data = json_input();
$email = strtolower(trim($data['email'] ?? ''));
$pass = (string) ($data['pass'] ?? '');

$stmt = $conn->prepare('SELECT id, password_hash FROM customers WHERE email = ?');
$stmt->bind_param('s', $email);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row || !password_verify($pass, $row['password_hash'])) {
    respond(['error' => 'Email o contraseña incorrectos.'], 401);
}

$_SESSION['customer_id'] = (int) $row['id'];
respond(['ok' => true]);
