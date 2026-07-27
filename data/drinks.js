// Sade içecek kataloğu.
// Değerler aksi belirtilmedikçe 100 ml içindir.

const USDA_SOURCE = 'USDA FoodData Central (Foundation / SR Legacy)';

function drink(
    id,
    name,
    kcal,
    protein,
    carb,
    fat,
    fiber = 0,
    sugar = 0,
    sodium = 0,
    options = {}
) {
    return {
        id,
        name,
        category: 'drink',
        ref_amount: 100,
        kcal_100: kcal,
        protein_100: protein,
        carb_100: carb,
        fat_100: fat,
        fiber_100: fiber,
        sugar_100: sugar,
        sodium_100: sodium,
        nutrition_confidence: options.confidence || 'verified',
        nutrition_source: options.source || USDA_SOURCE
    };
}

export const drinks = [
    drink('drink_water', 'Su', 0, 0, 0, 0, 0, 0, 0),
    drink('drink_mineral_water', 'Maden Suyu (Sade)', 0, 0, 0, 0, 0, 0, 20, {
        confidence: 'estimated',
        source: 'Markaya göre değişir; ortalama etiket değeri'
    }),

    // Kullanıcının tercih ettiği sütler
    drink('drink_pinar_protein_plain', 'Pınar Protein Süt Sade (52 g Protein, Laktozsuz)', 43, 5.2, 4.9, 0.3, 0, 4.9, 45, {
        source: 'Pınar ürün etiketi'
    }),
    drink('drink_pinar_protein_coffee', 'Pınar Protein Süt Kahveli (52 g Protein, Laktozsuz)', 48, 5.2, 6.1, 0.3, 0, 6.1, 45, {
        source: 'Pınar ürün etiketi'
    }),
    drink('drink_milk_lactose_free', 'Laktozsuz Süt', 47, 3.3, 4.8, 1.5, 0, 4.8, 45, {
        confidence: 'estimated',
        source: 'Yaygın yarım yağlı ürün etiketi ortalaması'
    }),
    drink('drink_ayran_plain', 'Ayran', 37, 2, 2.9, 2, 0, 2.9, 240, {
        confidence: 'estimated',
        source: 'Yaygın sade ayran etiketi ortalaması'
    }),
    drink('drink_kefir_plain', 'Kefir (Sade)', 61, 3.3, 4.8, 3.2, 0, 4.8, 40),

    // Şekersiz sıcak ve soğuk içecekler
    drink('drink_tea_black', 'Siyah Çay (Şekersiz)', 1, 0, 0.3, 0, 0, 0, 1),
    drink('drink_tea_green', 'Yeşil Çay (Şekersiz)', 0, 0, 0, 0, 0, 0, 1),
    drink('drink_tea_herbal', 'Bitki Çayı (Şekersiz)', 1, 0, 0.2, 0, 0, 0, 1, {
        confidence: 'estimated',
        source: 'Demleme içecek ortalaması'
    }),
    drink('drink_coffee_filter', 'Filtre Kahve (Sade)', 2, 0.3, 0, 0, 0, 0, 2),
    drink('drink_coffee_americano', 'Americano (Sade)', 2, 0.3, 0.2, 0, 0, 0, 2),
    drink('drink_coffee_espresso', 'Espresso (Sade)', 9, 0.5, 1.7, 0.2, 0, 0, 14),
    drink('drink_coffee_turkish', 'Türk Kahvesi (Sade)', 2, 0.2, 0.3, 0, 0, 0, 2, {
        confidence: 'estimated',
        source: 'Şekersiz hazırlanmış fincan ortalaması'
    }),
    drink('drink_latte_plain', 'Latte (Yarım Yağlı, Şekersiz)', 44, 2.9, 4.3, 1.5, 0, 4.3, 40, {
        confidence: 'estimated',
        source: 'Standart espresso ve yarım yağlı süt tarifi'
    }),
    drink('drink_latte_iced', 'Buzlu Latte (Yarım Yağlı, Şekersiz)', 44, 2.9, 4.3, 1.5, 0, 4.3, 40, {
        confidence: 'estimated',
        source: 'Standart espresso ve yarım yağlı süt tarifi'
    }),

    // Ambalajlı ve meyveli içecekler
    drink('drink_cola_regular', 'Kola', 42, 0, 10.6, 0, 0, 10.6, 4, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_cola_zero', 'Kola (Şekersiz)', 0, 0, 0, 0, 0, 0, 12, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_orange_juice', 'Portakal Suyu (%100)', 45, 0.7, 10.4, 0.2, 0.2, 8.4, 1),
    drink('drink_apple_juice', 'Elma Suyu (%100)', 46, 0.1, 11.3, 0.1, 0.2, 9.6, 4),
    drink('drink_pomegranate_juice', 'Nar Suyu (%100)', 54, 0.2, 13, 0.1, 0.1, 12.7, 2),
    drink('drink_lemon_water', 'Limonlu Su (Şekersiz)', 2, 0, 0.6, 0, 0.1, 0.2, 1, {
        confidence: 'estimated',
        source: 'Suya az miktarda taze limon eklenmiş tarif'
    }),
    drink('drink_turnip_juice', 'Şalgam Suyu', 12, 0.3, 2.3, 0, 0, 0.6, 500, {
        confidence: 'estimated',
        source: 'Markaya göre değişir; ortalama ürün etiketi'
    }),
    drink('drink_energy_regular', 'Enerji İçeceği', 45, 0, 11, 0, 0, 11, 40, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),

    // Günlük yaşamda sık karşılaşılan diğer içecekler
    drink('drink_coffee_cold_brew', 'Cold Brew (Sade)', 2, 0.3, 0, 0, 0, 0, 2),
    drink('drink_coffee_cappuccino', 'Cappuccino (Şekersiz)', 40, 2.7, 3.8, 1.5, 0, 3.8, 38, {
        confidence: 'estimated',
        source: 'Standart espresso ve yarım yağlı süt tarifi'
    }),
    drink('drink_coffee_mocha', 'Mocha (Şekersiz)', 60, 3, 7, 2.2, 0.5, 5.5, 42, {
        confidence: 'estimated',
        source: 'Standart kahve dükkanı tarifi'
    }),
    drink('drink_hot_chocolate', 'Sıcak Çikolata', 77, 3.1, 12.3, 2.2, 0.6, 10.5, 45, {
        confidence: 'estimated',
        source: 'Standart sütlü tarif ortalaması'
    }),
    drink('drink_iced_tea_sugared', 'Soğuk Çay (Şekerli)', 30, 0, 7.4, 0, 0, 7.4, 8, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_iced_tea_zero', 'Soğuk Çay (Şekersiz)', 1, 0, 0.2, 0, 0, 0, 8, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_lemonade_sugared', 'Limonata (Şekerli)', 40, 0.1, 10.3, 0, 0.1, 9.8, 2, {
        confidence: 'estimated',
        source: 'Standart ev tipi tarif ortalaması'
    }),
    drink('drink_lemonade_zero', 'Limonata (Şekersiz)', 2, 0.1, 0.6, 0, 0.1, 0.2, 2, {
        confidence: 'estimated',
        source: 'Standart şekersiz tarif ortalaması'
    }),
    drink('drink_soda_regular', 'Gazoz', 39, 0, 9.8, 0, 0, 9.8, 5, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_tonic_regular', 'Tonik', 34, 0, 8.8, 0, 0, 8.8, 12, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_grape_juice', 'Üzüm Suyu (%100)', 60, 0.4, 14.8, 0.1, 0.2, 14.2, 5),
    drink('drink_pineapple_juice', 'Ananas Suyu (%100)', 53, 0.4, 12.9, 0.1, 0.2, 10, 2),
    drink('drink_sour_cherry_nectar', 'Vişne Nektarı', 50, 0.2, 12.3, 0.1, 0.1, 11.5, 4, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_carrot_juice', 'Havuç Suyu', 40, 0.9, 9.3, 0.2, 0.8, 3.9, 66),
    drink('drink_tomato_juice', 'Domates Suyu', 17, 0.9, 3.5, 0.1, 0.4, 2.6, 250, {
        confidence: 'estimated',
        source: 'Tuz eklenmiş ürün etiketi ortalaması'
    }),
    drink('drink_coconut_water', 'Hindistan Cevizi Suyu', 19, 0.7, 3.7, 0.2, 1.1, 2.6, 105),
    drink('drink_kombucha_plain', 'Kombucha (Sade)', 13, 0, 3, 0, 0, 2.5, 5, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_kefir_fruit', 'Kefir (Meyveli)', 75, 3, 11, 2.2, 0, 10, 45, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    drink('drink_sparkling_lemon_sugared', 'Limonlu Gazlı İçecek', 38, 0, 9.5, 0, 0, 9.5, 8, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    })
];
