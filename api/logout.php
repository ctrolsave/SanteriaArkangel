<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

$_SESSION = [];
session_destroy();
respond(['ok' => true]);
