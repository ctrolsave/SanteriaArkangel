<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_csrf();

$data = json_input();
$email = strtolower(trim($data['email'] ?? ''));
$pass = (string) ($data['pass'] ?? '');

if ($email === '' || $pass === '') {
    respond(['error' => 'Completá tu email y contraseña.'], 400);
}

// Protección contra fuerza bruta: máximo 8 intentos fallidos cada 15 minutos por email.
// Se limita por email (no por IP) para no bloquear a otros clientes que compartan
// la misma red (wifi pública, oficina) mientras alguien intenta adivinar una cuenta puntual.
$conn->query('DELETE FROM customer_login_attempts WHERE created_at < (NOW() - INTERVAL 15 MINUTE)');
$check = $conn->prepare('SELECT COUNT(*) AS c FROM customer_login_attempts WHERE email = ?');
$check->bind_param('s', $email);
$check->execute();
$attempts = (int) ($check->get_result()->fetch_assoc()['c'] ?? 0);
if ($attempts >= 8) {
    respond(['error' => 'Demasiados intentos fallidos. Esperá 15 minutos e intentá de nuevo.'], 429);
}

$stmt = $conn->prepare('SELECT id, password_hash FROM customers WHERE email = ?');
$stmt->bind_param('s', $email);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row || !password_verify($pass, $row['password_hash'])) {
    $log = $conn->prepare('INSERT INTO customer_login_attempts (email) VALUES (?)');
    $log->bind_param('s', $email);
    $log->execute();
    respond(['error' => 'Email o contraseña incorrectos.'], 401);
}

$clear = $conn->prepare('DELETE FROM customer_login_attempts WHERE email = ?');
$clear->bind_param('s', $email);
$clear->execute();

$_SESSION['customer_id'] = (int) $row['id'];
respond(['ok' => true]);
