<?php
/**
 * Plugin Name: GOS Site Pages
 * Description: Renders website pages that are authored and published in GOS ("דפי אתר"). WordPress displays; GOS owns the content.
 * Version:     1.1.0
 * Author:      Grafitiyul OS
 *
 * ── What this does ─────────────────────────────────────────────────────────
 * A WordPress page whose slug matches a GOS page slug is rendered from the
 * content GOS published. WordPress holds NO editable copy: the WP page exists
 * only to own the URL, the theme chrome and the <head>. Editors work in GOS.
 *
 * ── Source of truth ────────────────────────────────────────────────────────
 *   drafts            → GOS only (never leave the admin API)
 *   published version → GOS, immutable, identified by versionId
 *   what WP shows     → the published version, cached locally
 *   if GOS is down    → the last successful payload, served from wp_options
 *
 * ── Caching (deliberate, documented) ───────────────────────────────────────
 * GOS answers `Cache-Control: no-store` and an `ETag` equal to the immutable
 * publish id. We cache the payload in a transient for GOS_SITE_PAGES_TTL and
 * revalidate with If-None-Match; a 304 costs nothing and refreshes the TTL.
 * Because a version id NEVER changes content, a cache hit can never be stale
 * in the dangerous sense — only "not yet aware of a newer publish", bounded by
 * the TTL, and clearable instantly from Settings → GOS Site Pages.
 *
 * A SEPARATE permanent option (never expires) keeps the last good payload. It
 * is used only when GOS is unreachable, so an outage degrades to "slightly old
 * content" instead of "blank page".
 *
 * ── Install ────────────────────────────────────────────────────────────────
 * 1. Copy this file to wp-content/plugins/gos-site-pages/gos-site-pages.php
 * 2. Activate "GOS Site Pages".
 * 3. Settings → GOS Site Pages → set the API base (default below).
 * 4. Create a WordPress Page whose slug matches the GOS slug
 *    (e.g. "restaurant-recommendations"). Leave its content EMPTY.
 */

if (!defined('ABSPATH')) { exit; }

define('GOS_SITE_PAGES_TTL', 300);              // 5 minutes
define('GOS_SITE_PAGES_TIMEOUT', 4);            // seconds; never block the page
define('GOS_SITE_PAGES_DEFAULT_API', 'https://app.grafitiyul.co.il/api/public');

function gos_sp_api_base() {
    $v = get_option('gos_sp_api_base');
    return untrailingslashit($v ? $v : GOS_SITE_PAGES_DEFAULT_API);
}

function gos_sp_locale() {
    // The site is Hebrew-first; an /en/ prefix (or ?lang=en) asks for English.
    if (isset($_GET['lang']) && $_GET['lang'] === 'en') { return 'en'; }
    return (strpos($_SERVER['REQUEST_URI'], '/en/') === 0) ? 'en' : 'he';
}

/**
 * Fetch a published page. Returns the decoded payload or null.
 * Never throws and never blocks longer than GOS_SITE_PAGES_TIMEOUT.
 */
function gos_sp_fetch($slug, $locale) {
    $cache_key  = 'gos_sp_' . md5($slug . '|' . $locale);
    $backup_key = 'gos_sp_backup_' . md5($slug . '|' . $locale);

    $cached = get_transient($cache_key);
    if ($cached !== false && is_array($cached) && isset($cached['payload'])) {
        return $cached['payload'];
    }

    $backup  = get_option($backup_key);
    $headers = array('Accept' => 'application/json');
    if (is_array($backup) && !empty($backup['etag'])) {
        $headers['If-None-Match'] = $backup['etag'];
    }

    $url = gos_sp_api_base() . '/site-pages/' . rawurlencode($slug) . '?locale=' . rawurlencode($locale);
    $res = wp_remote_get($url, array('timeout' => GOS_SITE_PAGES_TIMEOUT, 'headers' => $headers));

    if (is_wp_error($res)) {
        // GOS unreachable — serve the last known good payload.
        return (is_array($backup) && isset($backup['payload'])) ? $backup['payload'] : null;
    }

    $code = wp_remote_retrieve_response_code($res);

    if ($code === 304 && is_array($backup) && isset($backup['payload'])) {
        set_transient($cache_key, array('payload' => $backup['payload']), GOS_SITE_PAGES_TTL);
        return $backup['payload'];
    }

    if ($code === 404) {
        // Explicitly unpublished/absent: do NOT fall back to a stale copy, or an
        // unpublished page would stay visible forever.
        delete_option($backup_key);
        delete_transient($cache_key);
        return null;
    }

    if ($code !== 200) {
        return (is_array($backup) && isset($backup['payload'])) ? $backup['payload'] : null;
    }

    $payload = json_decode(wp_remote_retrieve_body($res), true);
    if (!is_array($payload) || empty($payload['html'])) {
        return (is_array($backup) && isset($backup['payload'])) ? $backup['payload'] : null;
    }

    $etag = wp_remote_retrieve_header($res, 'etag');
    set_transient($cache_key, array('payload' => $payload), GOS_SITE_PAGES_TTL);
    update_option($backup_key, array('payload' => $payload, 'etag' => $etag), false);

    return $payload;
}

/** The GOS payload for the page currently being rendered, or null. */
function gos_sp_current() {
    static $memo = null;
    static $done = false;
    if ($done) { return $memo; }
    $done = true;

    if (!is_page()) { return null; }
    $post = get_queried_object();
    if (!$post || empty($post->post_name)) { return null; }

    // Only pages left deliberately EMPTY are taken over by GOS. A page with its
    // own WordPress content keeps it — this plugin can never silently replace
    // something an editor wrote in WP.
    if (trim(strip_tags($post->post_content)) !== '') { return null; }

    $memo = gos_sp_fetch($post->post_name, gos_sp_locale());
    return $memo;
}

/** Replace the (empty) WordPress content with the GOS-rendered fragment. */
add_filter('the_content', function ($content) {
    if (!in_the_loop() || !is_main_query()) { return $content; }
    $payload = gos_sp_current();
    if (!$payload) { return $content; }

    $style = '';
    if (!empty($payload['stylesheet'])) {
        $style = '<style id="gos-site-page-css">' . $payload['stylesheet'] . '</style>';
    }
    // The HTML was sanitized server-side by GOS before it was ever stored.
    return $style . $payload['html'];
}, 9);

/** SEO: title, description, canonical, Open Graph, structured data. */
add_action('wp_head', function () {
    $payload = gos_sp_current();
    if (!$payload || empty($payload['seo'])) { return; }
    $seo = $payload['seo'];

    // A GOS page flagged noindex is a deliberately unlisted asset (e.g. a B2B
    // price list shared as a direct link): keep crawlers out entirely.
    if (!empty($seo['noindex'])) {
        echo '<meta name="robots" content="noindex,nofollow">' . "\n";
    }
    if (!empty($seo['description'])) {
        echo '<meta name="description" content="' . esc_attr($seo['description']) . '">' . "\n";
    }
    if (!empty($seo['canonical'])) {
        echo '<link rel="canonical" href="' . esc_url($seo['canonical']) . '">' . "\n";
    }
    if (!empty($seo['ogTitle'])) {
        echo '<meta property="og:title" content="' . esc_attr($seo['ogTitle']) . '">' . "\n";
    }
    if (!empty($seo['ogDescription'])) {
        echo '<meta property="og:description" content="' . esc_attr($seo['ogDescription']) . '">' . "\n";
    }
    if (!empty($seo['ogImage'])) {
        echo '<meta property="og:image" content="' . esc_url($seo['ogImage']) . '">' . "\n";
    }
    if (!empty($seo['canonical'])) {
        echo '<meta property="og:url" content="' . esc_url($seo['canonical']) . '">' . "\n";
    }
    if (!empty($seo['locale'])) {
        echo '<meta property="og:locale" content="' . esc_attr($seo['locale']) . '">' . "\n";
    }
    if (!empty($payload['structuredData'])) {
        echo '<script type="application/ld+json">' .
             wp_json_encode($payload['structuredData'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) .
             '</script>' . "\n";
    }
}, 1);

/** Yoast/other SEO plugins must not fight GOS over the title. */
add_filter('pre_get_document_title', function ($title) {
    $payload = gos_sp_current();
    if ($payload && !empty($payload['seo']['title'])) { return $payload['seo']['title']; }
    return $title;
}, 20);

add_filter('wpseo_canonical', function ($canonical) {
    $payload = gos_sp_current();
    if ($payload && !empty($payload['seo']['canonical'])) { return $payload['seo']['canonical']; }
    return $canonical;
}, 20);

add_filter('wpseo_metadesc', function ($desc) {
    $payload = gos_sp_current();
    if ($payload && !empty($payload['seo']['description'])) { return $payload['seo']['description']; }
    return $desc;
}, 20);

// Yoast must agree with GOS about indexability, or the page would carry two
// conflicting robots directives. GOS's noindex wins and implies nofollow.
add_filter('wpseo_robots', function ($robots) {
    $payload = gos_sp_current();
    if ($payload && !empty($payload['seo']['noindex'])) { return 'noindex, nofollow'; }
    return $robots;
}, 20);

// Keep noindex GOS pages OUT of the Yoast XML sitemap. Only pages with empty
// WP content (i.e. GOS-owned pages) are ever considered, and the payload is
// read from the local cache/backup first — sitemap generation stays cheap.
add_filter('wpseo_exclude_from_sitemap_by_post_ids', function ($excluded) {
    $pages = get_pages(array('post_status' => 'publish'));
    foreach ($pages as $p) {
        if (trim(strip_tags($p->post_content)) !== '') { continue; }
        $payload = gos_sp_fetch($p->post_name, 'he');
        if (is_array($payload) && !empty($payload['seo']['noindex'])) {
            $excluded[] = $p->ID;
        }
    }
    return $excluded;
}, 20);

// ── Cache purge endpoint ───────────────────────────────────────────────────
// GOS can call this on publish so a change is live immediately instead of within
// the TTL. Shared-secret authenticated; it only clears caches, never writes
// content, so the worst case of a leaked secret is a cache miss.
add_action('rest_api_init', function () {
    register_rest_route('gos/v1', '/purge', array(
        'methods'  => 'POST',
        'permission_callback' => '__return_true',
        'callback' => function (WP_REST_Request $req) {
            $secret = get_option('gos_sp_purge_secret');
            if (!$secret || !hash_equals($secret, (string) $req->get_header('x-gos-secret'))) {
                return new WP_REST_Response(array('ok' => false), 401);
            }
            $slug = sanitize_title((string) $req->get_param('slug'));
            foreach (array('he', 'en') as $loc) {
                delete_transient('gos_sp_' . md5($slug . '|' . $loc));
            }
            return new WP_REST_Response(array('ok' => true, 'slug' => $slug), 200);
        },
    ));
});

// ── Settings screen ────────────────────────────────────────────────────────
add_action('admin_menu', function () {
    add_options_page('GOS Site Pages', 'GOS Site Pages', 'manage_options', 'gos-site-pages', function () {
        if (!current_user_can('manage_options')) { return; }
        if (isset($_POST['gos_sp_nonce']) && wp_verify_nonce($_POST['gos_sp_nonce'], 'gos_sp_save')) {
            update_option('gos_sp_api_base', esc_url_raw($_POST['gos_sp_api_base']));
            update_option('gos_sp_purge_secret', sanitize_text_field($_POST['gos_sp_purge_secret']));
            if (!empty($_POST['gos_sp_flush'])) {
                global $wpdb;
                $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_gos_sp_%'");
                echo '<div class="notice notice-success"><p>Cache cleared.</p></div>';
            }
            echo '<div class="notice notice-success"><p>Saved.</p></div>';
        }
        $base   = esc_attr(gos_sp_api_base());
        $secret = esc_attr(get_option('gos_sp_purge_secret'));
        echo '<div class="wrap"><h1>GOS Site Pages</h1><form method="post">';
        wp_nonce_field('gos_sp_save', 'gos_sp_nonce');
        echo '<table class="form-table">';
        echo '<tr><th>GOS public API base</th><td><input name="gos_sp_api_base" value="' . $base . '" class="regular-text" dir="ltr"></td></tr>';
        echo '<tr><th>Purge secret</th><td><input name="gos_sp_purge_secret" value="' . $secret . '" class="regular-text" dir="ltr"></td></tr>';
        echo '<tr><th>Clear cache now</th><td><label><input type="checkbox" name="gos_sp_flush" value="1"> clear all cached GOS pages</label></td></tr>';
        echo '</table>';
        submit_button();
        echo '</form></div>';
    });
});
