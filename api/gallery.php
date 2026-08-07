<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

function get_images($conn) {
    $row = $conn->query('SELECT about_images FROM settings WHERE id = 1')->fetch_assoc();
    $images = json_decode($row['about_images'] ?? '[]', true);
    return is_array($images) ? $images : [];
}

function save_images($conn, $images) {
    $json = json_encode(array_values($images));
    $stmt = $conn->prepare('UPDATE settings SET about_images = ? WHERE id = 1');
    $stmt->bind_param('s', $json);
    $stmt->execute();
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    respond(get_images($conn));
}

if ($method === 'POST') {
    require_csrf();
    require_admin();
    $action = $_POST['action'] ?? 'add';
    $images = get_images($conn);

    if ($action === 'remove') {
        $path = $_POST['path'] ?? '';
        $images = array_filter($images, fn($p) => $p !== $path);
        save_images($conn, $images);
        respond(array_values($images));
    }

    $newPath = handle_image_upload('photo', 'about', 1400, true);
    if ($newPath) {
        $images[] = $newPath;
        save_images($conn, $images);
    }
    respond(array_values($images));
}

respond(['error' => 'Método no permitido'], 405);
