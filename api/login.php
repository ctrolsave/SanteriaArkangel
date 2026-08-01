<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_csrf();

$ip = $_SERVER['REMOTE_ADDR'] ?? '';

// Protección contra fuerza bruta: máximo 5 intentos fallidos cada 15 minutos por IP.
$conn->query('DELETE FROM admin_login_attempts WHERE created_at < (NOW() - INTERVAL 15 MINUTE)');
$check = $conn->prepare('SELECT COUNT(*) AS c FROM admin_login_attempts WHERE ip = ?');
$check->bind_param('s', $ip);
$check->execute();
$attempts = (int) ($check->get_result()->fetch_assoc()['c'] ?? 0);
if ($attempts >= 5) {
    respond(['error' => 'Demasiados intentos fallidos. Esperá 15 minutos e intentá de nuevo.'], 429);
}

$data = json_input();
$user = trim($data['user'] ?? '');
$pass = (string)($data['pass'] ?? '');

if ($user === '' || $pass === '') {
    respond(['error' => 'Completá usuario y contraseña.'], 400);
}

$stmt = $conn->prepare('SELECT admin_user, admin_pass FROM settings WHERE id = 1');
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

$storedPass = $row['admin_pass'] ?? '';
$isHashed = (strpos($storedPass, '$2y$') === 0 || strpos($storedPass, '$2b$') === 0 || strpos($storedPass, '$argon2') === 0);
$validUser = $row && hash_equals($row['admin_user'], $user);
$validPass = $validUser && ($isHashed ? password_verify($pass, $storedPass) : hash_equals($storedPass, $pass));

if (!$validPass) {
    $log = $conn->prepare('INSERT INTO admin_login_attempts (ip) VALUES (?)');
    $log->bind_param('s', $ip);
    $log->execute();
    respond(['error' => 'Usuario o contraseña incorrectos.'], 401);
}

// Si la contraseña todavía estaba guardada en texto plano, la migramos a un hash seguro.
if (!$isHashed) {
    $newHash = password_hash($pass, PASSWORD_DEFAULT);
    $upd = $conn->prepare('UPDATE settings SET admin_pass = ? WHERE id = 1');
    $upd->bind_param('s', $newHash);
    $upd->execute();
}

$clear = $conn->prepare('DELETE FROM admin_login_attempts WHERE ip = ?');
$clear->bind_param('s', $ip);
$clear->execute();

$_SESSION['admin_logged_in'] = true;
respond(['ok' => true]);
