<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$data = json_input();
$user = trim($data['user'] ?? '');
$pass = (string)($data['pass'] ?? '');

if ($user === '' || $pass === '') {
    respond(['error' => 'Completá usuario y contraseña.'], 400);
}

$stmt = $conn->prepare('SELECT admin_user, admin_pass FROM settings WHERE id = 1');
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row || $row['admin_user'] !== $user) {
    respond(['error' => 'Usuario o contraseña incorrectos.'], 401);
}

$storedPass = $row['admin_pass'];
$isHashed = (strpos($storedPass, '$2y$') === 0 || strpos($storedPass, '$2b$') === 0 || strpos($storedPass, '$argon2') === 0);

$ok = $isHashed ? password_verify($pass, $storedPass) : hash_equals($storedPass, $pass);

if (!$ok) {
    respond(['error' => 'Usuario o contraseña incorrectos.'], 401);
}

// Si la contraseña todavía estaba guardada en texto plano, la migramos a un hash seguro.
if (!$isHashed) {
    $newHash = password_hash($pass, PASSWORD_DEFAULT);
    $upd = $conn->prepare('UPDATE settings SET admin_pass = ? WHERE id = 1');
    $upd->bind_param('s', $newHash);
    $upd->execute();
}

$_SESSION['admin_logged_in'] = true;
respond(['ok' => true]);
