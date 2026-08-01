<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_csrf();

$data = json_input();
$token = trim($data['token'] ?? '');
$pass = (string) ($data['pass'] ?? '');

if ($token === '' || strlen($pass) < 8) {
    respond(['error' => 'Completá una contraseña de al menos 8 caracteres.'], 400);
}

$tokenHash = hash('sha256', $token);
$stmt = $conn->prepare('SELECT id, customer_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > NOW()');
$stmt->bind_param('s', $tokenHash);
$stmt->execute();
$reset = $stmt->get_result()->fetch_assoc();

if (!$reset) {
    respond(['error' => 'El link venció o ya se usó. Pedí uno nuevo.'], 400);
}

$hash = password_hash($pass, PASSWORD_DEFAULT);
$upd = $conn->prepare('UPDATE customers SET password_hash = ? WHERE id = ?');
$upd->bind_param('si', $hash, $reset['customer_id']);
$upd->execute();

// Invalida este link y cualquier otro pedido de recuperación pendiente de la cuenta.
$mark = $conn->prepare('UPDATE password_resets SET used = 1 WHERE customer_id = ?');
$mark->bind_param('i', $reset['customer_id']);
$mark->execute();

respond(['ok' => true]);
