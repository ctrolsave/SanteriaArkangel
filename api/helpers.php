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

/**
 * Token anti-CSRF: se guarda en la sesión PHP y el frontend lo pide una vez
 * (api/csrf.php) al cargar la página, mandándolo de vuelta en el header
 * X-CSRF-Token en cada POST. Como un sitio de otro dominio no puede leer la
 * sesión del usuario ni ese header, no puede forjar el pedido/guardado.
 */
function csrf_token() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function require_csrf() {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($sent === '' || empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $sent)) {
        respond(['error' => 'Sesión inválida o vencida. Recargá la página e intentá de nuevo.'], 403);
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

function fetch_all_products($conn) {
    $products = [];
    $res = $conn->query('SELECT * FROM products ORDER BY sort_order DESC, created_at DESC');
    while ($p = $res->fetch_assoc()) {
        $pid = (int) $p['id'];

        $tiers = [];
        $tq = $conn->prepare('SELECT min_qty, price FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC');
        $tq->bind_param('i', $pid);
        $tq->execute();
        $tr = $tq->get_result();
        while ($t = $tr->fetch_assoc()) {
            $tiers[] = ['minQty' => (int) $t['min_qty'], 'price' => (float) $t['price']];
        }
        if (empty($tiers)) {
            $tiers[] = ['minQty' => 1, 'price' => 0];
        }

        $groups = [];
        $gq = $conn->prepare('SELECT id, name FROM variant_groups WHERE product_id = ? ORDER BY sort_order ASC, id ASC');
        $gq->bind_param('i', $pid);
        $gq->execute();
        $gr = $gq->get_result();
        while ($g = $gr->fetch_assoc()) {
            $gid = (int) $g['id'];
            $options = [];
            $oq = $conn->prepare('SELECT id, value, image, tiers_json, stock FROM variant_options WHERE group_id = ? ORDER BY sort_order ASC, id ASC');
            $oq->bind_param('i', $gid);
            $oq->execute();
            $or_ = $oq->get_result();
            while ($o = $or_->fetch_assoc()) {
                $optTiers = json_decode($o['tiers_json'] ?? '[]', true);
                $options[] = ['id' => (int) $o['id'], 'value' => $o['value'], 'image' => $o['image'], 'tiers' => is_array($optTiers) ? $optTiers : [], 'stock' => (int) $o['stock']];
            }
            $groups[] = ['id' => $gid, 'name' => $g['name'], 'options' => $options];
        }

        // Si el producto tiene variantes, cada opción tiene su propio stock
        // (ej: "vela rosa" y "vela azul" no comparten pool) y el producto en
        // general está disponible mientras cada grupo tenga al menos una
        // opción con stock — el número de products.stock deja de usarse acá.
        // Si no tiene variantes, se sigue usando el stock del producto.
        if (!empty($groups)) {
            $inStock = true;
            foreach ($groups as $g) {
                $groupHasStock = false;
                foreach ($g['options'] as $o) {
                    if ($o['stock'] > 0) { $groupHasStock = true; break; }
                }
                if (!$groupHasStock) { $inStock = false; break; }
            }
        } else {
            $inStock = ((int) $p['stock']) > 0;
        }

        $products[] = [
            'id' => $pid,
            'name' => $p['name'],
            'category' => $p['category'],
            'description' => $p['description'],
            'image' => $p['image'],
            'isOffer' => (bool) $p['is_offer'],
            'offerPrice' => $p['offer_price'] !== null ? (float) $p['offer_price'] : null,
            'createdAt' => $p['created_at'],
            'inStock' => $inStock,
            'stock' => (int) $p['stock'],
            'tiers' => $tiers,
            'variantGroups' => $groups,
        ];
    }
    return $products;
}

/**
 * Registra un movimiento de stock (ingreso, venta o ajuste manual) y aplica
 * el delta en la misma operación, para que el número de stock y el
 * historial nunca queden desincronizados entre sí. Si se pasa $optionId,
 * el stock que cambia es el de esa opción puntual (ej: "Mod1 recta") en
 * vez del stock general del producto.
 */
function log_stock_movement($conn, $productId, $type, $delta, $note = '', $optionId = null) {
    if ($delta === 0) return;
    if ($optionId) {
        $stmt = $conn->prepare('UPDATE variant_options SET stock = GREATEST(0, stock + ?) WHERE id = ?');
        $stmt->bind_param('ii', $delta, $optionId);
        $stmt->execute();
        $row = $conn->prepare('SELECT stock FROM variant_options WHERE id = ?');
        $row->bind_param('i', $optionId);
        $row->execute();
    } else {
        $stmt = $conn->prepare('UPDATE products SET stock = GREATEST(0, stock + ?) WHERE id = ?');
        $stmt->bind_param('ii', $delta, $productId);
        $stmt->execute();
        $row = $conn->prepare('SELECT stock FROM products WHERE id = ?');
        $row->bind_param('i', $productId);
        $row->execute();
    }
    $resulting = (int) ($row->get_result()->fetch_assoc()['stock'] ?? 0);

    $ins = $conn->prepare('INSERT INTO stock_movements (product_id, option_id, type, delta, resulting_stock, note) VALUES (?,?,?,?,?,?)');
    $ins->bind_param('iisiis', $productId, $optionId, $type, $delta, $resulting, $note);
    $ins->execute();
}

/**
 * Devuelve las opciones elegidas (una por cada grupo de variantes que
 * tenga selección), para poder revisar/descontar el stock de cada una al
 * confirmar una venta. Mismo criterio de matching que resolve_tiers_for_selection.
 */
function resolve_selected_options($product, $selection) {
    $result = [];
    foreach ($product['variantGroups'] as $g) {
        if (!isset($selection[$g['id']])) continue;
        $optId = $selection[$g['id']];
        foreach ($g['options'] as $o) {
            if ($o['id'] == $optId) { $result[] = $o; break; }
        }
    }
    return $result;
}

/**
 * Las siguientes cuatro funciones recalculan, del lado del servidor, el mismo
 * precio que ya calcula el frontend (ver assets/js/app.js: priceForQty,
 * effectiveTiers, resolveTiersForSelection, optionsLabel). Se usan al crear un
 * pedido para no confiar nunca en el precio/nombre/variante que mande el cliente.
 */
function price_for_qty($tiers, $qty) {
    usort($tiers, fn($a, $b) => $a['minQty'] <=> $b['minQty']);
    $price = $tiers[0]['price'] ?? 0;
    foreach ($tiers as $t) {
        if ($qty >= $t['minQty']) $price = $t['price'];
    }
    return (float) $price;
}

function effective_tiers($product, $tiersList) {
    $base = !empty($tiersList) ? $tiersList : $product['tiers'];
    usort($base, fn($a, $b) => $a['minQty'] <=> $b['minQty']);
    if (!empty($base) && $product['isOffer'] && $product['offerPrice']) {
        $base[0]['price'] = $product['offerPrice'];
    }
    return $base;
}

function resolve_tiers_for_selection($product, $selection) {
    foreach ($product['variantGroups'] as $g) {
        if (!isset($selection[$g['id']])) continue;
        $optId = $selection[$g['id']];
        foreach ($g['options'] as $o) {
            if ($o['id'] == $optId && !empty($o['tiers'])) return $o['tiers'];
        }
    }
    return $product['tiers'];
}

function options_label($product, $selection) {
    $parts = [];
    foreach ($product['variantGroups'] as $g) {
        if (!isset($selection[$g['id']])) continue;
        $optId = $selection[$g['id']];
        foreach ($g['options'] as $o) {
            if ($o['id'] == $optId) { $parts[] = $g['name'] . ': ' . $o['value']; break; }
        }
    }
    return implode(' · ', $parts);
}

/**
 * Manda el email con el link para restablecer la contraseña. El link lleva el
 * token en texto plano (por eso viaja solo por email, nunca se guarda así en
 * la base — ver password_resets.token_hash), y expira solo por su fecha.
 */
function send_password_reset_email($conn, $email, $customerName, $token) {
    $row = $conn->query('SELECT store_name FROM settings WHERE id = 1')->fetch_assoc();
    $storeName = ($row['store_name'] ?? '') ?: 'tu tienda';

    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $link = "$scheme://$host/index.html?reset=" . urlencode($token);

    $subject = "Recuperar tu contraseña en $storeName";
    $body = "Hola" . ($customerName ? " $customerName" : "") . ",\n\n"
          . "Pediste recuperar tu contraseña en $storeName.\n"
          . "Entrá a este link para elegir una nueva (válido por 1 hora):\n$link\n\n"
          . "Si no fuiste vos, ignorá este mensaje — tu contraseña actual sigue funcionando.";
    $headers = "Content-Type: text/plain; charset=UTF-8\r\nFrom: $storeName <no-reply@$host>";
    @mail($email, $subject, $body, $headers);
}

/**
 * Le avisa al administrador que entró un pedido nuevo, por email y por WhatsApp
 * (si configuró esos datos en Administrar > Configuración). Si algo falla,
 * no interrumpe la creación del pedido — solo no llega el aviso.
 */
function notify_new_order($conn, $orderId, $customerName, $total, $itemsSummary, $deliveryMethod = 'envio') {
    $row = $conn->query('SELECT store_name, notify_email, notify_whatsapp_number, notify_whatsapp_apikey FROM settings WHERE id = 1')->fetch_assoc();
    if (!$row) return;

    $storeName = $row['store_name'] ?: 'tu tienda';
    $totalFmt = number_format((float) $total, 0, ',', '.');
    $deliveryLabel = $deliveryMethod === 'retiro' ? 'Retiro en el local' : 'Envío a domicilio';

    if (!empty($row['notify_email'])) {
        $subject = "Nuevo pedido #$orderId en $storeName";
        $body = "Nuevo pedido #$orderId\n"
              . "Cliente: $customerName\n"
              . "Entrega: $deliveryLabel\n"
              . "Total: \$$totalFmt\n\n"
              . "Productos:\n$itemsSummary\n\n"
              . "Entrá a Administrar > Pedidos para ver el detalle completo.";
        $headers = "Content-Type: text/plain; charset=UTF-8\r\nFrom: $storeName <no-reply@" . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ">";
        @mail($row['notify_email'], $subject, $body, $headers);
    }

    if (!empty($row['notify_whatsapp_number']) && !empty($row['notify_whatsapp_apikey'])) {
        $text = "🔔 Nuevo pedido #$orderId en $storeName\nCliente: $customerName\nEntrega: $deliveryLabel\nTotal: \$$totalFmt";
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
function handle_image_upload($fileField, $subfolder, $maxWidth = 1000, $forceJpeg = false) {
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

    // Para fotos (productos, opciones, galería) forzamos JPEG: un PNG de una
    // foto pesa 5-15x más y hace lenta la tienda. Solo se conserva PNG (con
    // su transparencia) cuando NO se fuerza JPEG, ej. el logo.
    $keepPng = ($mime === 'image/png' && !$forceJpeg);

    $dst = imagecreatetruecolor($newWidth, $newHeight);
    if ($keepPng || $mime === 'image/webp') {
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefilledrectangle($dst, 0, 0, $newWidth, $newHeight, $transparent);
    } else {
        // Fondo blanco por si la imagen original tenía transparencia (el JPEG no la soporta).
        $white = imagecolorallocate($dst, 255, 255, 255);
        imagefilledrectangle($dst, 0, 0, $newWidth, $newHeight, $white);
    }
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

    $uploadsRoot = dirname(__DIR__) . '/uploads/' . $subfolder . '/';
    if (!is_dir($uploadsRoot)) {
        mkdir($uploadsRoot, 0755, true);
    }

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
