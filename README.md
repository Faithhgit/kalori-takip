# Denge — Beslenme ve Makro Takibi

HTML, CSS ve Vanilla JavaScript ile geliştirilmiş; verilerini Firebase Firestore'da
saklayan, kurulabilir bir kalori ve makro takip uygulaması.

## Özellikler

- Günlük kalori ve makro takibi
- Kahvaltı, öğle, akşam ve ara öğün grupları
- Hazır katalogda arama, favoriler ve son kullanılanlar
- Özel besin oluşturma
- Kayıtlı öğünler oluşturma ve günlüğe toplu ekleme
- Günlük geçmişi, tarih aralığı filtresi ve gün kopyalama
- Haftalık grafik, hedef serisi ve motivasyon özeti
- Profil bilgilerine göre BMR, TDEE, kalori ve makro hedefi hesaplama
- Kilo takibi ve yeterli veri olduğunda adaptif TDEE tahmini
- JSON yedekleme/geri yükleme ve CSV dışa aktarma
- Açık/koyu tema, mobil alt gezinme ve PWA çevrimdışı uygulama kabuğu
- Gelecekte cihaz verileri için ayrılmış Sağlık sayfası

## Besin Kataloğu

- Yiyecek: 205
- İçecek: 100
- Toplam: 305

Aynı ada sahip farklı porsiyon veya hazırlama türleri arayüzde ayırt edici
bilgilerle gösterilir.

## Proje Yapısı

```text
/
|-- index.html
|-- styles.css
|-- app.js
|-- router.js
|-- firebase-config.js
|-- manifest.webmanifest
|-- sw.js
|-- icon.svg
|-- data/
|   |-- foods.js
|   `-- drinks.js
|-- lib/
|   `-- nutrition.js
|-- scripts/
|   `-- audit-data.mjs
|-- tests/
|   `-- nutrition.test.mjs
|-- package.json
`-- README.md
```

## Yerelde Çalıştırma

ES modülleri ve service worker nedeniyle dosyayı doğrudan açmak yerine proje
klasöründe bir statik sunucu başlatın:

```bash
python -m http.server 4173
```

Ardından `http://127.0.0.1:4173/` adresini açın.

## Firebase Kurulumu

1. Bir Firebase projesi oluşturun.
2. Firestore Database'i etkinleştirin.
3. `firebase-config.js` içindeki yapılandırmayı kendi projenizle değiştirin.
4. Firestore güvenlik kurallarını kullanım modelinize göre tanımlayın.

Uygulama şu anda kişisel kullanım için tek veri alanı kullanır; birden fazla
kişinin kullanacağı dağıtımlarda kullanıcı doğrulama ve kullanıcıya özel
Firestore yolları eklenmelidir.

## Kontroller

Node.js kuruluysa:

```bash
npm test
npm run audit:data
```

İlk komut besin, hedef ve adaptif TDEE hesaplarını; ikinci komut statik besin
kataloğundaki kimlikleri ve zorunlu alanları denetler.

## Ana Veri Modeli

`daily_logs` kayıtları temel olarak şu alanları taşır:

```js
{
  date: "YYYY-MM-DD",
  item_id: "food_001 | drink_001 | custom_...",
  item_name: "Ürün adı",
  grams: 150,
  item_type: "food | drink",
  unit: "g | ml",
  meal_type: "breakfast | lunch | dinner | snack",
  kcal: 250,
  protein: 30,
  carb: 15,
  fat: 8,
  created_at: Timestamp
}
```

`data/foods.js` ve `data/drinks.js` uygulamanın salt okunur başlangıç
kataloğudur. Kullanıcının eklediği besinler `custom_items` koleksiyonunda
saklanır.
