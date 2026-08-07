<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $row = $conn->query('SELECT store_name, store_logo, hero_image, hero_image_mobile, whatsapp, cbu, alias, titular, mp_link, about_text, about_summary, distribuidores_text, etica_text, contact_address, contact_phone, contact_email, contact_hours, catalog_pdf FROM settings WHERE id = 1')->fetch_assoc();
    $row = $row ?: [];

    // Estos datos son privados del dueño de la tienda (credenciales de admin, datos
    // de contacto para avisos): solo se devuelven si quien pide ya está logueado como admin.
    if (is_admin()) {
        $admin = $conn->query('SELECT notify_email, notify_whatsapp_number, notify_whatsapp_apikey, admin_user FROM settings WHERE id = 1')->fetch_assoc();
        $row = array_merge($row, $admin ?: []);
    }

    respond($row);
}

if ($method === 'POST') {
    require_csrf();
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
    $heroPath = handle_image_upload('hero_image', 'brand', 1800, true);
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
    $heroMobilePath = handle_image_upload('hero_image_mobile', 'brand', 1000, true);
    if ($heroMobilePath) {
        $updates[] = 'hero_image_mobile = ?';
        $params[] = $heroMobilePath;
        $types .= 's';
    }
    if (isset($_POST['remove_hero_image_mobile']) && $_POST['remove_hero_image_mobile'] === '1') {
        $updates[] = 'hero_image_mobile = ?';
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
