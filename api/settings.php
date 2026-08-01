<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $row = $conn->query('SELECT store_name, store_logo, hero_image, whatsapp, cbu, alias, titular, mp_link, about_text, about_summary, distribuidores_text, etica_text, contact_address, contact_phone, contact_email, contact_hours, notify_email, notify_whatsapp_number, notify_whatsapp_apikey, catalog_pdf, admin_user FROM settings WHERE id = 1')->fetch_assoc();
    respond($row ?: []);
}

if ($method === 'POST') {
    require_admin();

    $fields = ['store_name', 'whatsapp', 'cbu', 'alias', 'titular', 'mp_link', 'about_text', 'about_summary', 'distribuidores_text', 'etica_text', 'contact_address', 'contact_phone', 'contact_email', 'contact_hours', 'notify_email', 'notify_whatsapp_number', 'notify_whatsapp_apikey'];
    $updates = [];
    $params = [];
    $types = '';

    foreach ($fields as $f) {
        if (isset($_POST[$f])) {
            $updates[] = "$f = ?";
            $params[] = trim($_POST[$f]);
            $types .= 's';
        }
    }

    // Cambio de usuario/contraseña de administrador (opcional)
    if (!empty($_POST['admin_user'])) {
        $updates[] = 'admin_user = ?';
        $params[] = trim($_POST['admin_user']);
        $types .= 's';
    }
    if (!empty($_POST['admin_pass'])) {
        $updates[] = 'admin_pass = ?';
        $params[] = password_hash($_POST['admin_pass'], PASSWORD_DEFAULT);
        $types .= 's';
    }

    $logoPath = handle_image_upload('store_logo', 'brand', 500);
    if ($logoPath) {
        $updates[] = 'store_logo = ?';
        $params[] = $logoPath;
        $types .= 's';
    }
    $heroPath = handle_image_upload('hero_image', 'brand', 1800);
    if ($heroPath) {
        $updates[] = 'hero_image = ?';
        $params[] = $heroPath;
        $types .= 's';
    }
    if (isset($_POST['remove_hero_image']) && $_POST['remove_hero_image'] === '1') {
        $updates[] = 'hero_image = ?';
        $params[] = '';
        $types .= 's';
    }

    $catalogPath = handle_pdf_upload('catalog_pdf');
    if ($catalogPath) {
        $updates[] = 'catalog_pdf = ?';
        $params[] = $catalogPath;
        $types .= 's';
    }

    if (empty($updates)) {
        respond(['ok' => true]);
    }

    $sql = 'UPDATE settings SET ' . implode(', ', $updates) . ' WHERE id = 1';
    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();

    respond(['ok' => true]);
}

respond(['error' => 'Método no permitido'], 405);
