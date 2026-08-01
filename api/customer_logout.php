<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

unset($_SESSION['customer_id']);
respond(['ok' => true]);
