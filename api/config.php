<?php
/**
 * Configuración de conexión a la base de datos.
 * Completá estos 4 datos con los que te da Hostinger en hPanel > Bases de datos MySQL.
 * El host casi siempre es "localhost" en Hostinger.
 */
define('DB_HOST', 'localhost');
define('DB_NAME', 'reemplazar_nombre_de_tu_base');
define('DB_USER', 'reemplazar_usuario');
define('DB_PASS', 'reemplazar_contraseña');

mysqli_report(MYSQLI_REPORT_OFF);
$conn = @new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);

if ($conn->connect_error) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'No se pudo conectar a la base de datos. Revisá los datos en api/config.php']);
    exit;
}
$conn->set_charset('utf8mb4');

session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 7,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
