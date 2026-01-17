# 🍽️ Kalori & Makro Takip Uygulaması

Kişisel kullanım için geliştirilmiş, sıfırdan HTML/CSS/JS ile oluşturulmuş kalori ve makro besin takip uygulaması.

## ✨ Özellikler

- ✅ Günlük kalori ve makro besin takibi (Protein, Karbonhidrat, Yağ)
- ✅ Son 7 günlük grafik görünümü
- ✅ Motivasyon mesajları ve ilerleme takibi
- ✅ Yiyecek ve içecek veritabanı (kolayca düzenlenebilir)
- ✅ Firebase Firestore ile cihazlar arası senkronizasyon
- ✅ Responsive tasarım (PC ve mobil uyumlu)
- ✅ Login/kayıt olmadan kullanım

## 📁 Dosya Yapısı

```
/
├── index.html              # Ana HTML dosyası
├── styles.css              # Stil dosyası
├── app.js                  # Ana JavaScript dosyası
├── firebase-config.js      # Firebase yapılandırması
├── data/
│   ├── foods.js           # Yiyecek listesi
│   └── drinks.js          # İçecek listesi
└── README.md              # Bu dosya
```

## 🚀 Kurulum

### 1. Firebase Projesi Oluşturma

1. [Firebase Console](https://console.firebase.google.com) adresine gidin
2. "Add project" ile yeni proje oluşturun
3. Proje adını girin (örn: "kalori-takip")
4. Google Analytics'i istediğiniz gibi yapılandırın (isteğe bağlı)

### 2. Firestore Database Kurulumu

1. Firebase Console'da sol menüden **"Build" > "Firestore Database"** seçin
2. **"Create database"** butonuna tıklayın
3. **"Start in test mode"** seçeneğini seçin (başlangıç için)
   - ⚠️ **ÖNEMLİ:** Test mode herkese açıktır, kişisel kullanım içindir
4. Location seçin (Europe için `eur3` önerilir)
5. **"Enable"** butonuna tıklayın

### 3. Web App Ekleme ve Config Alma

1. Firebase Console'da proje ana sayfasında **"</>  Web"** ikonuna tıklayın
2. App nickname girin (örn: "kalori-web")
3. Firebase Hosting'i şimdilik atlayın
4. Gösterilen yapılandırma kodunu kopyalayın:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

5. Bu bilgileri `firebase-config.js` dosyasına yapıştırın

### 4. Firestore Security Rules (Önemli!)

Test mode varsayılan olarak **30 gün** sonra erişimi kapatır. Kişisel kullanım için kuralları güncelleyin:

1. Firestore Database > **"Rules"** sekmesine gidin
2. Aşağıdaki kuralları yapıştırın:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /daily_logs/{document=**} {
      allow read, write: if true;
    }
  }
}
```

⚠️ **GÜVENLİK UYARISI:** 
- Bu kurallar herkesin verilerinize erişmesine izin verir
- **Sadece kişisel kullanım** için uygundur
- URL'yi kimseyle paylaşmayın
- Daha güvenli kullanım için Firebase Authentication ekleyin

## 📦 Vercel'e Deploy Etme

### Hazırlık
1. Projeyi GitHub'a yükleyin
2. [Vercel](https://vercel.com) hesabı oluşturun

### Deploy Adımları

1. Vercel Dashboard'da **"Add New" > "Project"** seçin
2. GitHub reponuzu seçin
3. Framework Preset: **"Other"** (statik site)
4. Build ayarlarını yapın:
   - Build Command: boş bırakın
   - Output Directory: `.` (proje kök dizini)
   - Install Command: boş bırakın
5. **"Deploy"** butonuna tıklayın

### Ortam Değişkenleri (İsteğe Bağlı)

Firebase config'i güvenli tutmak için:
1. `firebase-config.js` dosyasını `.gitignore`'a ekleyin
2. Vercel'de Environment Variables ekleyin
3. Build sırasında config dosyasını oluşturun

## 🍎 Yiyecek/İçecek Listesi Düzenleme

### Yeni Yiyecek Ekleme (`data/foods.js`)

```javascript
{
    id: 'food_016',                    // Benzersiz ID
    name: 'Kırmızı Mercimek Çorbası',  // Ürün adı
    kcal_100: 95,                       // 100g başına kalori
    protein_100: 5,                     // 100g başına protein (gram)
    carb_100: 15,                       // 100g başına karbonhidrat (gram)
    fat_100: 1.5                        // 100g başına yağ (gram)
}
```

### Yeni İçecek Ekleme (`data/drinks.js`)

```javascript
{
    id: 'drink_011',                   // Benzersiz ID
    name: 'Türk Kahvesi',              // Ürün adı
    kcal_100: 2,                        // 100ml başına kalori
    protein_100: 0.2,                   // 100ml başına protein (gram)
    carb_100: 0.3,                      // 100ml başına karbonhidrat (gram)
    fat_100: 0                          // 100ml başına yağ (gram)
}
```

**Not:** Değerleri değiştirdiğinizde dosyayı kaydedin ve tarayıcıyı yenileyin.

## 🎯 Hedef Değerleri Değiştirme

`app.js` dosyasında `TARGETS` nesnesini düzenleyin:

```javascript
const TARGETS = {
    kcal: 2200,      // Günlük kalori hedefi
    protein: 150,    // Günlük protein hedefi (gram)
    carb: 250,       // Günlük karbonhidrat hedefi (gram)
    fat: 70          // Günlük yağ hedefi (gram)
};
```

## 📱 Kullanım

1. Uygulamayı açın
2. **"Ürün Tipi"** seçin (Yiyecek/İçecek)
3. Arama kutusuna ürün adı yazın
4. Listeden ürünü seçin
5. Gram miktarını girin
6. Önizlemede hesaplanan değerleri kontrol edin
7. **"Ekle"** butonuna tıklayın

### Kayıt Silme
- Her kayıtın yanındaki **"Sil"** butonuna tıklayın
- Onay verin

## 🔧 Teknik Detaylar

### Kullanılan Teknolojiler
- **HTML5** - Sayfa yapısı
- **CSS3** - Stil ve animasyonlar
- **Vanilla JavaScript (ES6+)** - İş mantığı
- **Firebase 10.x** - Veritabanı (Firestore)

### Firebase SDK Import
```javascript
// ES Module import (CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, ... } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
```

### Firestore Veri Yapısı

**Koleksiyon:** `daily_logs`

**Döküman Yapısı:**
```javascript
{
    date: "2025-01-17",           // YYYY-MM-DD formatında tarih
    item_id: "food_001",          // Ürün ID'si
    item_name: "Tavuk Göğsü",     // Ürün adı
    grams: 150,                   // Miktar (gram/ml)
    kcal: 248,                    // Hesaplanan kalori
    protein: 47,                  // Hesaplanan protein
    carb: 0,                      // Hesaplanan karbonhidrat
    fat: 5,                       // Hesaplanan yağ
    created_at: Timestamp         // Oluşturulma zamanı
}
```

## 🐛 Sorun Giderme

### "Firebase bağlantısı kurulamadı" hatası
- `firebase-config.js` dosyasındaki bilgileri kontrol edin
- Firebase Console'da projenin aktif olduğundan emin olun

### Veriler görünmüyor
- Tarayıcı konsolunu açın (F12) ve hataları kontrol edin
- Firestore kurallarının doğru ayarlandığından emin olun
- İnternet bağlantınızı kontrol edin

### Mobilde düzgün çalışmıyor
- Tarayıcı cache'ini temizleyin
- Safari için "Experimental Features" ayarlarını kontrol edin

## 📝 Lisans

Bu proje kişisel kullanım için geliştirilmiştir. Özgürce kullanabilir ve değiştirebilirsiniz.

## 🤝 Katkıda Bulunma

1. Projeyi fork edin
2. Yeni özellik ekleyin
3. Pull request gönderin

## ⚠️ Önemli Notlar

- Bu uygulama **kişisel kullanım** için tasarlanmıştır
- Login/Authentication sistemi yoktur
- Firestore test mode kullanıldığında veriler herkese açıktır
- URL'yi kimseyle paylaşmayın
- Üretim ortamında Authentication eklenmesi önerilir
- Besin değerleri yaklaşık değerlerdir, profesyonel danışmanlık yerine geçmez

## 📧 Destek

Sorularınız için GitHub Issues kullanabilirsiniz.

---

**Afiyet olsun! 🎉**