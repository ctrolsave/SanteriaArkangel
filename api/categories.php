<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $names = [];
    $res = $conn->query('SELECT name FROM categories ORDER BY name ASC');
    while ($row = $res->fetch_assoc()) {
        $names[] = $row['name'];
    }
    respond($names);
}

if ($method === 'POST') {
    require_csrf();
    require_admin();
    $action = $_POST['action'] ?? '';

    if ($action === 'add') {
        $name = trim($_POST['name'] ?? '');
        if ($name === '') respond(['error' => 'Escribí un nombre para la categoría.'], 400);
        $stmt = $conn->prepare('INSERT IGNORE INTO categories (name) VALUES (?)');
        $stmt->bind_param('s', $name);
        $stmt->execute();
    } elseif ($action === 'rename') {
        $old = trim($_POST['old'] ?? '');
        $new = trim($_POST['new'] ?? '');
        if ($old === '' || $new === '') respond(['error' => 'Faltan datos para renombrar.'], 400);
        $stmt = $conn->prepare('UPDATE categories SET name = ? WHERE name = ?');
        $stmt->bind_param('ss', $new, $old);
        $stmt->execute();
        // Actualiza también los productos que ya tenían la categoría vieja
        $stmt2 = $conn->prepare('UPDATE products SET category = ? WHERE category = ?');
        $stmt2->bind_param('ss', $new, $old);
        $stmt2->execute();
    } elseif ($action === 'remove') {
        $name = trim($_POST['name'] ?? '');
        $stmt = $conn->prepare('DELETE FROM categories WHERE name = ?');
        $stmt->bind_param('s', $name);
        $stmt->execute();
    }

    $names = [];
    $res = $conn->query('SELECT name FROM categories ORDER BY name ASC');
    while ($row = $res->fetch_assoc()) {
        $names[] = $row['name'];
    }
    respond($names);
}

respond(['error' => 'Método no permitido'], 405);
