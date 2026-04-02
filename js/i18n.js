class I18nManager {
    constructor() {
        this.lang = localStorage.getItem('heatflow_lang') || 'TR';
        
        this.dict = {
            'EN': {
                'statSpread': 'Spread',
                'statBidDepth': 'Bid Depth',
                'statAskDepth': 'Ask Depth',
                'statWhales': 'Whales',
                'statData': 'Data',
                'btnInfo': 'Quick Guide',
                'btnSettings': 'Settings',
                'statusConnecting': 'CONNECTING...',
                'statusLive': 'LIVE',
                'statusDisconnected': 'DISCONNECTED',
                
                'settingsTitle': 'HeatFlow Settings',
                'whaleThreshold': 'Whale Order Threshold',
                'whaleDesc': 'Trades larger than this threshold are highlighted and tagged.',
                'heatmapContrast': 'Heatmap Contrast Curve',
                'heatmapDesc': 'Lower values show thin orders, higher values isolate massive block orders.',
                'animQuality': 'Animation Quality',
                'perfMode': 'Performance Mode (Low-end PCs)',
                
                'infoTitle': 'Quick Start Guide',
                'infoDesc': 'HeatFlow is a real-time micro-structure analysis platform.',
                'infoShield': 'Shield: Appears when massive limit orders absorb heavy market buying/selling (Iceberg/Absorption).',
                'infoGhost': 'Ghost: Draws pulled massive limit orders that vanished without executing (Spoofing).',
                'infoReversal': 'Reversal: Flashes a signal when delta and price diverge indicating exhaustion.',
                'infoCascade': 'Cascade: Screen flashes when chained liquidations occur.',
                'infoPoc': 'Global POC: The core horizontal support/resistance line where most volume traded.',
                
                'alertCascade': '💥 CASCADING STOPS!',
                'soundOff': 'Sound Off',
                'soundOn': 'Sound On',
                'autoScroll': 'Auto-Scroll',
                'shortcutZoomY': 'Zoom Y',
                'shortcutZoomX': 'Zoom X',
                'shortcutReset': 'Reset View',
                'shortcutPan': 'Pan',

                'canvasPoc': 'POC',
                'canvasReversal': '⚠️ REVERSAL',
                'canvasVolProfile': 'VOLUME PROFILE'
            },
            'TR': {
                'statSpread': 'Fark (Spread)',
                'statBidDepth': 'Alış Derinliği',
                'statAskDepth': 'Satış Derinliği',
                'statWhales': 'Balinalar',
                'statData': 'Veri',
                'btnInfo': 'Bilgi Kılavuzu',
                'btnSettings': 'Ayarlar',
                'statusConnecting': 'BAĞLANIYOR...',
                'statusLive': 'CANLI',
                'statusDisconnected': 'BAĞLANTI KOPTU',
                
                'settingsTitle': 'HeatFlow Ayarları',
                'whaleThreshold': 'Balina İşlemi Eşiği (Whale Threshold)',
                'whaleDesc': 'Bu eşiğin üzerindeki işlemler işaretlenir ve etiketlenir.',
                'heatmapContrast': 'Heatmap Kontrast Oranı',
                'heatmapDesc': 'Düşük değerler zayıf emirleri gösterirken, yüksek değerler sadece büyük blokları görünür kılar.',
                'animQuality': 'Animasyon Kalitesi',
                'perfMode': 'Performans Modu (Düşük Sistemler)',
                
                'infoTitle': 'Hızlı Başlangıç Kılavuzu',
                'infoDesc': 'HeatFlow gerçek zamanlı mikro-yapı analiz platformudur.',
                'infoShield': 'Kalkan: Devasa limit emirler piyasa alımlarına rağmen dayandığında çıkar (Iceberg).',
                'infoGhost': 'Hayalet: İşlem görmeden aniden silinen büyük limit emirleri çizer (Spoofing).',
                'infoReversal': 'Dönüş: Delta ve fiyat arasında oluşan uyuşmazlıklarda dönüş sinyali yakar.',
                'infoCascade': 'Şelale: Zincirleme stop patlamaları olduğunda ekran aydınlaması.',
                'infoPoc': 'Global POC: Yatay eksende en çok işlemin yaşandığı merkezi destek çizgisi.',
                
                'alertCascade': '💥 ZİNCİRLEME STOPLAR!',
                'soundOff': 'Sessiz',
                'soundOn': 'Ses Açık',
                'autoScroll': 'Oto-Kaydır',
                'shortcutZoomY': 'Y Yakınlaştır',
                'shortcutZoomX': 'X Yakınlaştır',
                'shortcutReset': 'Sıfırla',
                'shortcutPan': 'Kaydır',

                'canvasPoc': 'EN ÇOK HACİM',
                'canvasReversal': '⚠️ DÖNÜŞ',
                'canvasVolProfile': 'HACİM PROFİLİ'
            }
        };
    }

    setLanguage(lang) {
        this.lang = lang;
        localStorage.setItem('heatflow_lang', lang);
        this.updateDOM();
    }

    toggle() {
        this.setLanguage(this.lang === 'TR' ? 'EN' : 'TR');
    }

    t(key) {
        const dictionary = this.dict[this.lang] || this.dict['EN'];
        return dictionary[key] || key;
    }

    updateDOM() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.t(key);
            
            if (el.tagName === 'INPUT' && el.type === 'placeholder') {
                el.placeholder = translation;
            } else {
                // If it contains child elements like <b> inside li, handle as innerHTML for specific keys
                if (key.startsWith('info') && key !== 'infoTitle' && key !== 'infoDesc') {
                    const iconMatch = el.innerHTML.match(/^(.*?<b>.*?<\/b>)/);
                    if (iconMatch) {
                        el.innerHTML = iconMatch[1] + ' ' + translation.split(': ')[1];
                    } else {
                        el.textContent = translation;
                    }
                } else {
                    // Prepend icon if it existed? Better to separate icons from text.
                    // For now, textContent is fine if we separate icons in HTML.
                    
                    // We need to be careful with buttons that have <span class="icon">
                    const iconSpan = el.querySelector('.icon');
                    if (iconSpan) {
                        el.childNodes.forEach(node => {
                            if (node.nodeType === 3 && node.nodeValue.trim()) {
                                node.nodeValue = ' ' + translation;
                            }
                        });
                    } else {
                        el.textContent = translation;
                    }
                }
            }
        });

        // Update Toggle button itself
        const btnLang = document.getElementById('btn-lang');
        if (btnLang) btnLang.textContent = this.lang;
    }
}

// Global instance
window.i18n = new I18nManager();
