/**
 * Cookie同意バナー
 *
 * 電気通信事業法に準拠したCookie同意取得機能
 * LocalStorageに同意状態を保存し、ページ読み込み時に確認
 */

(function() {
    'use strict';

    // Cookie同意状態のキー
    const CONSENT_KEY = 'hallel_cookie_consent';
    const CONSENT_TIMESTAMP_KEY = 'hallel_cookie_consent_timestamp';

    // Cookie同意の有効期限（1年 = 365日）
    const CONSENT_EXPIRY_DAYS = 365;

    /**
     * Cookie同意バナーを表示
     */
    function showCookieBanner() {
        // 既に同意済みかチェック
        const consent = getConsentStatus();
        if (consent !== null) {
            // 同意済みまたは拒否済み
            return;
        }

        // バナーHTML作成
        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.className = 'cookie-consent-banner';
        banner.innerHTML = `
            <div class="cookie-consent-content">
                <div class="cookie-consent-text">
                    <p>
                        <strong>🍪 Cookie（クッキー）の使用について</strong><br>
                        当サイトでは、サービスの提供と改善のためにCookieを使用しています。
                        引き続きサイトをご利用いただく場合、Cookieの使用に同意したものとみなします。
                    </p>
                    <p class="cookie-consent-links">
                        詳細は<a href="/privacy-policy" target="_blank">プライバシーポリシー</a>をご確認ください。
                    </p>
                </div>
                <div class="cookie-consent-buttons">
                    <button id="cookie-accept-btn" class="cookie-btn cookie-btn-accept">
                        同意する
                    </button>
                    <button id="cookie-reject-btn" class="cookie-btn cookie-btn-reject">
                        必須のみ
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // ボタンイベント
        document.getElementById('cookie-accept-btn').addEventListener('click', function() {
            setConsent(true);
            hideBanner();
        });

        document.getElementById('cookie-reject-btn').addEventListener('click', function() {
            setConsent(false);
            hideBanner();
        });

        // アニメーション表示
        setTimeout(() => {
            banner.classList.add('show');
        }, 300);
    }

    /**
     * Cookie同意バナーを非表示
     */
    function hideBanner() {
        const banner = document.getElementById('cookie-consent-banner');
        if (banner) {
            banner.classList.remove('show');
            setTimeout(() => {
                banner.remove();
            }, 300);
        }
    }

    /**
     * Cookie同意状態を取得
     * @returns {boolean|null} true=同意, false=拒否, null=未設定
     */
    function getConsentStatus() {
        try {
            const consent = localStorage.getItem(CONSENT_KEY);
            const timestamp = localStorage.getItem(CONSENT_TIMESTAMP_KEY);

            if (!consent || !timestamp) {
                return null;
            }

            // 有効期限チェック
            const consentDate = new Date(parseInt(timestamp));
            const now = new Date();
            const daysDiff = (now - consentDate) / (1000 * 60 * 60 * 24);

            if (daysDiff > CONSENT_EXPIRY_DAYS) {
                // 有効期限切れ
                localStorage.removeItem(CONSENT_KEY);
                localStorage.removeItem(CONSENT_TIMESTAMP_KEY);
                return null;
            }

            return consent === 'true';
        } catch (e) {
            console.error('Failed to get consent status:', e);
            return null;
        }
    }

    /**
     * Cookie同意状態を保存
     * @param {boolean} accepted - true=同意, false=拒否
     */
    function setConsent(accepted) {
        try {
            localStorage.setItem(CONSENT_KEY, accepted.toString());
            localStorage.setItem(CONSENT_TIMESTAMP_KEY, Date.now().toString());

            // Googleアナリティクス等の処理（将来的に追加する場合）
            if (accepted) {
                console.log('Cookie accepted: Analytics tracking enabled');
                // 例: ga('send', 'event', 'cookie-consent', 'accept');
            } else {
                console.log('Cookie rejected: Only essential cookies');
                // 例: 分析Cookieを無効化
            }
        } catch (e) {
            console.error('Failed to set consent:', e);
        }
    }

    /**
     * ページ読み込み時の初期化
     */
    function init() {
        // DOMContentLoaded後に実行
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showCookieBanner);
        } else {
            showCookieBanner();
        }
    }

    // 初期化実行
    init();

    // グローバルに公開（他のスクリプトから利用可能にする）
    window.HallelCookieConsent = {
        getConsentStatus: getConsentStatus,
        setConsent: setConsent,
        showBanner: showCookieBanner
    };
})();
