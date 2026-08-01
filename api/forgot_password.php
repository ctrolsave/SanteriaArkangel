<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';
require_csrf();

$data = json_input();
$email = strtolower(trim($data['email'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(['error' => 'Ingresá un email válido.'], 400);
}

$conn->query('DELETE FROM password_resets WHERE expires_at < NOW()');

$stmt = $conn->prepare('SELECT id, name FROM customers WHERE email = ?');
$stmt->bind_param('s', $email);
$stmt->execute();
$customer = $stmt->get_result()->fetch_assoc();

// Siempre respondemos igual, exista o no la cuenta, para no revelar qué
// emails están registrados en el sitio (evita enumeración de cuentas).
if ($customer) {
    // Freno contra abuso: máximo 3 pedidos de recuperación cada 30 minutos por cuenta.
    $check = $conn->prepare('SELECT COUNT(*) AS c FROM password_resets WHERE customer_id = ? AND created_at > (NOW() - INTERVAL 30 MINUTE)');
    $check->bind_param('i', $customer['id']);
    $check->execute();
    $recent = (int) ($check->get_result()->fetch_assoc()['c'] ?? 0);

    if ($recent < 3) {
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $expiresAt = date('Y-m-d H:i:s', time() + 3600);

        $ins = $conn->prepare('INSERT INTO password_resets (customer_id, token_hash, expires_at) VALUES (?, ?, ?)');
        $ins->bind_param('iss', $customer['id'], $tokenHash, $expiresAt);
        $ins->execute();

        send_password_reset_email($conn, $email, $customer['name'], $token);
    }
}

respond(['ok' => true]);
