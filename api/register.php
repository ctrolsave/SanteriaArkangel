<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_csrf();

$data = json_input();
$name = trim($data['name'] ?? '');
$email = strtolower(trim($data['email'] ?? ''));
$pass = (string) ($data['pass'] ?? '');
$phone = trim($data['phone'] ?? '');

if ($name === '' || $email === '' || strlen($pass) < 8) {
    respond(['error' => 'Completá nombre, email y una contraseña de al menos 8 caracteres.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'El email no es válido.'], 400);
}

// Freno liviano contra registro masivo automatizado: máximo 5 cuentas nuevas
// cada 30 minutos desde la misma IP.
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$conn->query('DELETE FROM registration_attempts WHERE created_at < (NOW() - INTERVAL 30 MINUTE)');
$check = $conn->prepare('SELECT COUNT(*) AS c FROM registration_attempts WHERE ip = ?');
$check->bind_param('s', $ip);
$check->execute();
if ((int) ($check->get_result()->fetch_assoc()['c'] ?? 0) >= 5) {
    respond(['error' => 'Demasiadas cuentas creadas desde esta conexión. Esperá un rato e intentá de nuevo.'], 429);
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
$customerId = $conn->insert_id;

$log = $conn->prepare('INSERT INTO registration_attempts (ip) VALUES (?)');
$log->bind_param('s', $ip);
$log->execute();

$_SESSION['customer_id'] = $customerId;
respond(['ok' => true]);
