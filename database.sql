-- Base de datos de Santería Arkangel
-- Importar este archivo desde phpMyAdmin en tu panel de Hostinger.

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  store_name VARCHAR(150) NOT NULL DEFAULT 'Santería Arkangel',
  store_logo VARCHAR(255) DEFAULT 'assets/img/logo-arkangel.png',
  hero_image VARCHAR(255) DEFAULT '',
  whatsapp VARCHAR(30) DEFAULT '',
  cbu VARCHAR(30) DEFAULT '',
  alias VARCHAR(60) DEFAULT '',
  titular VARCHAR(120) DEFAULT '',
  mp_link VARCHAR(255) DEFAULT '',
  about_text TEXT,
  about_summary VARCHAR(500) DEFAULT '',
  about_images TEXT,
  distribuidores_text TEXT,
  etica_text TEXT,
  contact_address VARCHAR(255) DEFAULT '',
  contact_phone VARCHAR(60) DEFAULT '',
  contact_email VARCHAR(150) DEFAULT '',
  contact_hours VARCHAR(150) DEFAULT '',
  notify_email VARCHAR(150) DEFAULT '',
  notify_whatsapp_number VARCHAR(30) DEFAULT '',
  notify_whatsapp_apikey VARCHAR(30) DEFAULT '',
  catalog_pdf VARCHAR(255) DEFAULT '',
  admin_user VARCHAR(60) NOT NULL DEFAULT 'muzaber',
  admin_pass VARCHAR(255) NOT NULL DEFAULT '2111'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (id, store_name, store_logo, about_text, about_summary, about_images, distribuidores_text, etica_text, contact_address, contact_phone, contact_email, contact_hours, admin_user, admin_pass)
VALUES (1, 'Santería Arkangel', 'assets/img/logo-arkangel.png',
  'En Santería Arkangel llevamos más de 30 años acompañando a nuestros clientes con la misma pasión, compromiso y dedicación que nos vio nacer. Somos una empresa familiar que ha construido su trayectoria sobre un principio fundamental: ofrecer productos de la más alta calidad y una atención cercana, honesta y personalizada.
A lo largo de estas décadas nos hemos especializado en la fabricación de velas, velones, sahumerios y una amplia variedad de productos esotéricos, elaborados con materias primas cuidadosamente seleccionadas para garantizar un excelente rendimiento y una experiencia única.
Además, somos importadores de artículos religiosos y esotéricos, acercando a nuestros clientes productos exclusivos y reconocidas marcas nacionales e internacionales, siempre seleccionadas por su calidad y autenticidad.
Nuestro compromiso es ofrecer un catálogo completo que acompañe las distintas prácticas espirituales, religiosas y de bienestar, brindando confianza tanto a clientes particulares como a revendedores de todo el país.
En Arkangel creemos que la calidad no es un detalle: es el valor que nos distingue desde hace más de tres décadas. Por eso seguimos innovando, incorporando nuevos productos y manteniendo el mismo compromiso con el que comenzamos, para que cada persona que nos elige encuentre excelencia, variedad y una atención que la haga sentir como en casa.
Más de 30 años de experiencia, tradición y calidad respaldan nuestro trabajo.',
  'Más de 36 años iluminando caminos con calidad, tradición y compromiso: fabricantes e importadores de velas, sahumerios y productos religiosos y esotéricos.',
  '[]',
  'Texto a completar desde Administrar → Páginas: cómo trabajar con nosotros como comercio o revendedor, condiciones de compra por mayor, zonas de envío, etc.',
  'Texto a completar desde Administrar → Páginas: tu código de ética o compromisos con clientes y proveedores.',
  '', '', '', '',
  'muzaber', '2111')
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO categories (name) VALUES
  ('Velas'), ('Inciensos y Sahumerios'), ('Hierbas'),
  ('Aceites y Perfumes'), ('Collares y Guías'), ('Imágenes y Estatuas'), ('Otros')
ON DUPLICATE KEY UPDATE name = name;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) DEFAULT 'Otros',
  description TEXT,
  image VARCHAR(255) DEFAULT '',
  is_offer TINYINT(1) DEFAULT 0,
  offer_price DECIMAL(12,2) DEFAULT NULL,
  stock INT NOT NULL DEFAULT 20,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS variant_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS variant_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  value VARCHAR(100) NOT NULL,
  image VARCHAR(255) DEFAULT '',
  tiers_json TEXT,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES variant_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS price_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  min_qty INT NOT NULL DEFAULT 1,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Productos de ejemplo (podés editarlos o borrarlos desde el panel de administrador)
INSERT INTO products (id, name, category, description, image) VALUES
  (1, 'Vela de los 7 Poderes', 'Velas', 'Vela para apertura de caminos y protección.', ''),
  (2, 'Incienso Sahumerio', 'Inciensos y Sahumerios', 'Sahumerio en varilla para limpieza energética.', '');

INSERT INTO variant_groups (id, product_id, name, sort_order) VALUES
  (1, 1, 'Color', 0),
  (2, 2, 'Aroma', 0);

INSERT INTO variant_options (group_id, value, sort_order) VALUES
  (1, 'Roja', 0), (1, 'Blanca', 1), (1, 'Verde', 2),
  (2, 'Sándalo', 0), (2, 'Mirra', 1), (2, 'Coco', 2);

INSERT INTO price_tiers (product_id, min_qty, price) VALUES
  (1, 1, 1800), (1, 6, 1600), (1, 12, 1400),
  (2, 1, 900), (2, 10, 800);

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(30) DEFAULT '',
  address VARCHAR(255) DEFAULT '',
  city VARCHAR(100) DEFAULT '',
  province VARCHAR(100) DEFAULT '',
  postal_code VARCHAR(20) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
  payment_method VARCHAR(30) NOT NULL DEFAULT 'transferencia',
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_snapshot TEXT,
  tracking_code VARCHAR(100) DEFAULT '',
  carrier VARCHAR(150) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  variant_label VARCHAR(255) DEFAULT '',
  qty INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registra los intentos fallidos de login del panel de administrador, para
-- poder bloquear por unos minutos a una IP que falla demasiadas veces seguidas.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
