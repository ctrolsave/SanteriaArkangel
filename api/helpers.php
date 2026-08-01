<?php
header('Content-Type: application/json; charset=utf-8');

function json_input() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function is_admin() {
    return !empty($_SESSION['admin_logged_in']);
}

function require_admin() {
    if (!is_admin()) {
        respond(['error' => 'No autorizado. Iniciá sesión como administrador.'], 401);
    }
}

function current_customer_id() {
    return isset($_SESSION['customer_id']) ? (int) $_SESSION['customer_id'] : null;
}

function require_customer() {
    $id = current_customer_id();
    if (!$id) {
        respond(['error' => 'Necesitás iniciar sesión para hacer esto.'], 401);
    }
    return $id;
}

/**
 * Le avisa al administrador que entró un pedido nuevo, por email y por WhatsApp
 * (si configuró esos datos en Administrar > Configuración). Si algo falla,
 * no interrumpe la creación del pedido — solo no llega el aviso.
 */
function notify_new_order($conn, $orderId, $customerName, $total, $itemsSummary) {
    $row = $conn->query('SELECT store_name, notify_email, notify_whatsapp_number, notify_whatsapp_apikey FROM settings WHERE id = 1')->fetch_assoc();
    if (!$row) return;

    $storeName = $row['store_name'] ?: 'tu tienda';
    $totalFmt = number_format((float) $total, 0, ',', '.');

    if (!empty($row['notify_email'])) {
        $subject = "Nuevo pedido #$orderId en $storeName";
        $body = "Nuevo pedido #$orderId\n"
              . "Cliente: $customerName\n"
              . "Total: \$$totalFmt\n\n"
              . "Productos:\n$itemsSummary\n\n"
              . "Entrá a Administrar > Pedidos para ver el detalle completo.";
        $headers = "Content-Type: text/plain; charset=UTF-8\r\nFrom: $storeName <no-reply@" . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ">";
        @mail($row['notify_email'], $subject, $body, $headers);
    }

    if (!empty($row['notify_whatsapp_number']) && !empty($row['notify_whatsapp_apikey'])) {
        $text = "🔔 Nuevo pedido #$orderId en $storeName\nCliente: $customerName\nTotal: \$$totalFmt";
        $url = "https://api.callmebot.com/whatsapp.php?phone=" . urlencode($row['notify_whatsapp_number'])
             . "&text=" . urlencode($text) . "&apikey=" . urlencode($row['notify_whatsapp_apikey']);
        $ctx = stream_context_create(['http' => ['timeout' => 4]]);
        @file_get_contents($url, false, $ctx);
    }
}

/**
 * Recibe un archivo PDF ($_FILES['campo']) y lo guarda en /uploads/brand/.
 * Devuelve la ruta relativa o null si no se envió archivo.
 */
function handle_pdf_upload($fileField, $subfolder = 'brand') {
    if (empty($_FILES[$fileField]) || $_FILES[$fileField]['error'] !== UPLOAD_ERR_OK) {
        return null;
    }
    $tmpPath = $_FILES[$fileField]['tmp_name'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);

    if ($mime !== 'application/pdf') {
        respond(['error' => 'El catálogo debe ser un archivo PDF.'], 400);
    }

    $uploadsRoot = dirname(__DIR__) . '/uploads/' . $subfolder . '/';
    if (!is_dir($uploadsRoot)) {
        mkdir($uploadsRoot, 0755, true);
    }
    $filename = 'catalogo-' . bin2hex(random_bytes(6)) . '.pdf';
    move_uploaded_file($tmpPath, $uploadsRoot . $filename);

    return 'uploads/' . $subfolder . '/' . $filename;
}
function handle_image_upload($fileField, $subfolder, $maxWidth = 1000) {
    if (empty($_FILES[$fileField]) || $_FILES[$fileField]['error'] !== UPLOAD_ERR_OK) {
        return null;
    }
    $tmpPath = $_FILES[$fileField]['tmp_name'];
    $info = @getimagesize($tmpPath);
    if (!$info) {
        respond(['error' => 'El archivo subido no es una imagen válida.'], 400);
    }
    $mime = $info['mime'];
    $allowed = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'];
    if (!isset($allowed[$mime])) {
        respond(['error' => 'Formato de imagen no soportado. Usá JPG, PNG o WEBP.'], 400);
    }

    $src = call_user_func($allowed[$mime], $tmpPath);
    if (!$src) {
        respond(['error' => 'No se pudo procesar la imagen.'], 400);
    }

    $width = imagesx($src);
    $height = imagesy($src);
    $scale = min(1, $maxWidth / $width);
    $newWidth = (int) round($width * $scale);
    $newHeight = (int) round($height * $scale);

    $dst = imagecreatetruecolor($newWidth, $newHeight);
    if ($mime === 'image/png' || $mime === 'image/webp') {
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefilledrectangle($dst, 0, 0, $newWidth, $newHeight, $transparent);
    }
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

    $uploadsRoot = dirname(__DIR__) . '/uploads/' . $subfolder . '/';
    if (!is_dir($uploadsRoot)) {
        mkdir($uploadsRoot, 0755, true);
    }

    $keepPng = ($mime === 'image/png');
    $ext = $keepPng ? 'png' : 'jpg';
    $filename = bin2hex(random_bytes(8)) . '.' . $ext;
    $fullPath = $uploadsRoot . $filename;

    if ($keepPng) {
        imagepng($dst, $fullPath, 6);
    } else {
        imagejpeg($dst, $fullPath, 78);
    }

    imagedestroy($src);
    imagedestroy($dst);

    return 'uploads/' . $subfolder . '/' . $filename;
}
