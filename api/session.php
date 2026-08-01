<?php
require __DIR__ . '/config.php';
require __DIR__ . '/helpers.php';

respond(['admin' => is_admin()]);
