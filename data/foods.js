// Sade ve ölçülebilir yiyecek kataloğu.
// Değerler aksi belirtilmedikçe 100 g yenilebilir ürün içindir.
// Temel kaynak: USDA FoodData Central Foundation / SR Legacy.

const USDA_SOURCE = 'USDA FoodData Central (Foundation / SR Legacy)';
const LABEL_SOURCE = 'Ürün etiketi';

function food(
    id,
    name,
    category,
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
        category,
        ref_amount: 100,
        kcal_100: kcal,
        protein_100: protein,
        carb_100: carb,
        fat_100: fat,
        fiber_100: fiber,
        sugar_100: sugar,
        sodium_100: sodium,
        nutrition_confidence: options.confidence || 'verified',
        nutrition_source: options.source || USDA_SOURCE,
        ...(options.search_aliases ? { search_aliases: options.search_aliases } : {}),
        ...(options.portion_grams ? { portion_grams: options.portion_grams } : {}),
        ...(options.piece_grams ? { piece_grams: options.piece_grams } : {}),
        ...(options.slice_grams ? { slice_grams: options.slice_grams } : {})
    };
}

export const foods = [
    // Protein kaynakları
    food('food_chicken_breast_cooked', 'Tavuk Göğsü (Pişmiş)', 'protein', 165, 31, 0, 3.6, 0, 0, 74),
    food('food_chicken_thigh_cooked', 'Tavuk But (Pişmiş, Derisiz)', 'protein', 209, 26, 0, 10.9, 0, 0, 90),
    food('food_turkey_breast_cooked', 'Hindi Göğsü (Pişmiş)', 'protein', 135, 29, 0, 1.8, 0, 0, 54),
    food('food_beef_tenderloin_cooked', 'Dana Bonfile (Pişmiş)', 'protein', 206, 30, 0, 9, 0, 0, 55),
    food('food_ground_beef_10_cooked', 'Dana Kıyma (%10 Yağ, Pişmiş)', 'protein', 217, 26.1, 0, 11.8, 0, 0, 75),
    food('food_beef_lean_cooked', 'Yağsız Dana Eti (Pişmiş)', 'protein', 196, 29, 0, 7.4, 0, 0, 58),
    food('food_salmon_cooked', 'Somon (Pişmiş)', 'protein', 206, 22.1, 0, 12.4, 0, 0, 59),
    food('food_seabass_cooked', 'Levrek (Pişmiş)', 'protein', 124, 23.6, 0, 2.6, 0, 0, 87),
    food('food_trout_cooked', 'Alabalık (Pişmiş)', 'protein', 168, 23.8, 0, 7.4, 0, 0, 61),
    food('food_tuna_water_drained', 'Ton Balığı (Suda, Süzülmüş)', 'protein', 116, 25.5, 0, 0.8, 0, 0, 247),
    food('food_tuna_oil_drained', 'Ton Balığı (Yağda, Süzülmüş)', 'protein', 198, 29.1, 0, 8.2, 0, 0, 354),
    food('food_sardine_oil_drained', 'Sardalya (Yağda, Süzülmüş)', 'protein', 208, 24.6, 0, 11.5, 0, 0, 505),
    food('food_egg_boiled', 'Yumurta (Haşlanmış)', 'protein', 155, 12.6, 1.1, 10.6, 0, 1.1, 124, { piece_grams: 55 }),
    food('food_egg_white_cooked', 'Yumurta Beyazı (Pişmiş)', 'protein', 52, 10.9, 0.7, 0.2, 0, 0.7, 166, { piece_grams: 33 }),
    food('food_yogurt_plain', 'Yoğurt (Sade)', 'protein', 61, 3.5, 4.7, 3.3, 0, 4.7, 46),
    food('food_yogurt_strained', 'Süzme Yoğurt (Yağsız)', 'protein', 59, 10.3, 3.6, 0.4, 0, 3.2, 36),
    food('food_cottage_cheese', 'Lor Peyniri', 'protein', 98, 11.1, 3.4, 4.3, 0, 2.7, 364),
    food('food_feta', 'Beyaz Peynir', 'protein', 264, 14.2, 4.1, 21.3, 0, 4.1, 917),
    food('food_kashar', 'Kaşar Peyniri', 'protein', 403, 24.9, 1.3, 33.1, 0, 0.5, 621, { slice_grams: 20 }),
    food('food_lentils_cooked', 'Yeşil Mercimek (Pişmiş)', 'protein', 116, 9, 20.1, 0.4, 7.9, 1.8, 2),
    food('food_chickpeas_cooked', 'Nohut (Pişmiş)', 'protein', 164, 8.9, 27.4, 2.6, 7.6, 4.8, 7),
    food('food_kidney_beans_cooked', 'Kuru Fasulye (Pişmiş)', 'protein', 127, 8.7, 22.8, 0.5, 6.4, 0.3, 1),
    food('food_green_peas_cooked', 'Bezelye (Pişmiş)', 'protein', 84, 5.4, 15.6, 0.2, 5.5, 5.9, 3),

    // Karbonhidrat kaynakları
    food('food_rice_white_cooked', 'Beyaz Pirinç (Pişmiş)', 'carb', 130, 2.7, 28.2, 0.3, 0.4, 0.1, 1),
    food('food_rice_brown_cooked', 'Esmer Pirinç (Pişmiş)', 'carb', 123, 2.7, 25.6, 1, 1.6, 0.2, 4),
    food('food_bulgur_cooked', 'Bulgur (Pişmiş)', 'carb', 83, 3.1, 18.6, 0.2, 4.5, 0.1, 5),
    food('food_pasta_cooked', 'Makarna (Pişmiş)', 'carb', 131, 5, 25, 1.1, 1.8, 0.6, 6),
    food('food_pasta_wholewheat_cooked', 'Tam Buğday Makarna (Pişmiş)', 'carb', 149, 5.5, 30.1, 1.7, 3.9, 0.8, 4),
    food('food_oats_dry', 'Yulaf Ezmesi (Kuru)', 'carb', 379, 13.2, 67.7, 6.5, 10.1, 1, 2),
    food('food_quinoa_cooked', 'Kinoa (Pişmiş)', 'carb', 120, 4.4, 21.3, 1.9, 2.8, 0.9, 7),
    food('food_bread_white', 'Beyaz Ekmek', 'carb', 266, 8.9, 49.4, 3.3, 2.7, 5, 490, { slice_grams: 25 }),
    food('food_bread_wholewheat', 'Tam Buğday Ekmeği', 'carb', 247, 13, 41, 3.4, 6.8, 6, 400, { slice_grams: 25 }),
    food('food_lavash', 'Lavaş', 'carb', 312, 8.3, 52, 8.3, 3, 2.2, 620, {
        confidence: 'estimated',
        source: 'Standart ürün etiketi ortalaması',
        piece_grams: 70
    }),
    food('food_tortilla_corn', 'Mısır Tortillası', 'carb', 218, 5.7, 44.6, 2.9, 6.3, 0.9, 45, { piece_grams: 28 }),
    food('food_potato_boiled', 'Patates (Haşlanmış)', 'carb', 87, 1.9, 20.1, 0.1, 1.8, 0.9, 4),
    food('food_sweet_potato_baked', 'Tatlı Patates (Fırınlanmış)', 'carb', 90, 2, 20.7, 0.2, 3.3, 6.5, 36),
    food('food_corn_boiled', 'Mısır (Haşlanmış)', 'carb', 96, 3.4, 21, 1.5, 2.4, 4.5, 1),

    // Sebzeler ve yeşillikler
    food('food_tomato_raw', 'Domates', 'vegetable', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 5),
    food('food_cucumber_raw', 'Salatalık', 'vegetable', 15, 0.7, 3.6, 0.1, 0.5, 1.7, 2),
    food('food_lettuce_romaine', 'Marul', 'vegetable', 17, 1.2, 3.3, 0.3, 2.1, 1.2, 8),
    food('food_lettuce_iceberg', 'Göbek Marul', 'vegetable', 14, 0.9, 3, 0.1, 1.2, 2, 10),
    food('food_arugula_raw', 'Roka', 'vegetable', 25, 2.6, 3.7, 0.7, 1.6, 2.1, 27),
    food('food_parsley_raw', 'Maydanoz', 'vegetable', 36, 3, 6.3, 0.8, 3.3, 0.9, 56, { search_aliases: ['Maydonoz'] }),
    food('food_dill_raw', 'Dereotu', 'vegetable', 43, 3.5, 7, 1.1, 2.1, 0, 61),
    food('food_mint_fresh', 'Taze Nane', 'vegetable', 44, 3.3, 8.4, 0.7, 6.8, 0, 30),
    food('food_spinach_raw', 'Ispanak', 'vegetable', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 79),
    food('food_purslane_raw', 'Semizotu', 'vegetable', 20, 2, 3.4, 0.4, 1.5, 0, 45),
    food('food_onion_raw', 'Soğan', 'vegetable', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 4),
    food('food_scallion_raw', 'Taze Soğan', 'vegetable', 32, 1.8, 7.3, 0.2, 2.6, 2.3, 16),
    food('food_garlic_raw', 'Sarımsak', 'vegetable', 149, 6.4, 33.1, 0.5, 2.1, 1, 17, { piece_grams: 3 }),
    food('food_carrot_raw', 'Havuç', 'vegetable', 41, 0.9, 9.6, 0.2, 2.8, 4.7, 69),
    food('food_broccoli_raw', 'Brokoli', 'vegetable', 34, 2.8, 6.6, 0.4, 2.6, 1.7, 33),
    food('food_cauliflower_raw', 'Karnabahar', 'vegetable', 25, 1.9, 5, 0.3, 2, 1.9, 30),
    food('food_cabbage_white_raw', 'Beyaz Lahana', 'vegetable', 25, 1.3, 5.8, 0.1, 2.5, 3.2, 18),
    food('food_cabbage_red_raw', 'Kırmızı Lahana', 'vegetable', 31, 1.4, 7.4, 0.2, 2.1, 3.8, 27),
    food('food_zucchini_raw', 'Kabak', 'vegetable', 17, 1.2, 3.1, 0.3, 1, 2.5, 8),
    food('food_eggplant_raw', 'Patlıcan', 'vegetable', 25, 1, 5.9, 0.2, 3, 3.5, 2),
    food('food_mushroom_raw', 'Mantar', 'vegetable', 22, 3.1, 3.3, 0.3, 1, 2, 5),
    food('food_pepper_red_raw', 'Kırmızı Biber', 'vegetable', 31, 1, 6, 0.3, 2.1, 4.2, 4),
    food('food_pepper_green_raw', 'Yeşil Biber', 'vegetable', 20, 0.9, 4.6, 0.2, 1.7, 2.4, 3),
    food('food_green_beans_raw', 'Taze Fasulye', 'vegetable', 31, 1.8, 7, 0.2, 2.7, 3.3, 6),
    food('food_celery_stalk_raw', 'Kereviz Sapı', 'vegetable', 14, 0.7, 3, 0.2, 1.6, 1.3, 80),
    food('food_beet_raw', 'Pancar', 'vegetable', 43, 1.6, 9.6, 0.2, 2.8, 6.8, 78),

    // Meyveler
    food('food_banana_raw', 'Muz', 'fruit', 89, 1.1, 22.8, 0.3, 2.6, 12.2, 1, { piece_grams: 118 }),
    food('food_apple_raw', 'Elma', 'fruit', 52, 0.3, 13.8, 0.2, 2.4, 10.4, 1, { piece_grams: 182 }),
    food('food_orange_raw', 'Portakal', 'fruit', 47, 0.9, 11.8, 0.1, 2.4, 9.4, 0, { piece_grams: 131 }),
    food('food_strawberry_raw', 'Çilek', 'fruit', 32, 0.7, 7.7, 0.3, 2, 4.9, 1),
    food('food_blueberry_raw', 'Yaban Mersini', 'fruit', 57, 0.7, 14.5, 0.3, 2.4, 10, 1),
    food('food_avocado_raw', 'Avokado', 'fruit', 160, 2, 8.5, 14.7, 6.7, 0.7, 7, { piece_grams: 150 }),
    food('food_kiwi_raw', 'Kivi', 'fruit', 61, 1.1, 14.7, 0.5, 3, 9, 3, { piece_grams: 69 }),
    food('food_grapes_raw', 'Üzüm', 'fruit', 69, 0.7, 18.1, 0.2, 0.9, 15.5, 2),
    food('food_peach_raw', 'Şeftali', 'fruit', 39, 0.9, 9.5, 0.3, 1.5, 8.4, 0, { piece_grams: 150 }),
    food('food_pineapple_raw', 'Ananas', 'fruit', 50, 0.5, 13.1, 0.1, 1.4, 9.9, 1),
    food('food_lemon_raw', 'Limon', 'fruit', 29, 1.1, 9.3, 0.3, 2.8, 2.5, 2, { piece_grams: 58 }),

    // Yağlar, kuruyemişler ve tohumlar
    food('food_almonds_raw', 'Badem', 'fat', 579, 21.2, 21.6, 49.9, 12.5, 4.4, 1),
    food('food_walnuts_raw', 'Ceviz', 'fat', 654, 15.2, 13.7, 65.2, 6.7, 2.6, 2),
    food('food_hazelnuts_raw', 'Fındık', 'fat', 628, 15, 16.7, 60.8, 9.7, 4.3, 0),
    food('food_peanut_butter', 'Fıstık Ezmesi', 'fat', 588, 25, 20, 50, 6, 9, 459),
    food('food_chia_seeds', 'Chia Tohumu', 'fat', 486, 16.5, 42.1, 30.7, 34.4, 0, 16),
    food('food_flaxseed', 'Keten Tohumu', 'fat', 534, 18.3, 28.9, 42.2, 27.3, 1.6, 30),
    food('food_olive_oil', 'Zeytinyağı', 'fat', 884, 0, 0, 100, 0, 0, 0),
    food('food_sunflower_oil', 'Ayçiçek Yağı', 'fat', 884, 0, 0, 100, 0, 0, 0),
    food('food_butter_unsalted', 'Tereyağı (Tuzsuz)', 'fat', 717, 0.9, 0.1, 81.1, 0, 0.1, 11),

    // Baharatlar, soslar ve tarif ekleri
    food('food_salt', 'Tuz', 'extra', 0, 0, 0, 0, 0, 0, 39300),
    food('food_sugar', 'Toz Şeker', 'extra', 387, 0, 100, 0, 0, 100, 0),
    food('food_black_pepper', 'Karabiber', 'extra', 251, 10.4, 64, 3.3, 25.3, 0.6, 20),
    food('food_chili_flakes', 'Pul Biber', 'extra', 318, 12, 56.6, 17.3, 27.2, 10.3, 30),
    food('food_paprika', 'Kırmızı Toz Biber', 'extra', 282, 14.1, 54, 12.9, 34.9, 10.3, 68),
    food('food_thyme_dried', 'Kekik (Kuru)', 'extra', 265, 9, 68.9, 4.3, 42.5, 1.7, 55),
    food('food_cumin', 'Kimyon', 'extra', 375, 17.8, 44.2, 22.3, 10.5, 2.3, 168),
    food('food_curry_powder', 'Köri Tozu', 'extra', 325, 14.3, 55.8, 14, 53.2, 2.8, 52),
    food('food_garlic_powder', 'Sarımsak Tozu', 'extra', 331, 16.6, 72.7, 0.7, 9, 2.4, 60),
    food('food_soy_sauce', 'Soya Sosu', 'extra', 53, 8.1, 4.9, 0.6, 0.8, 0.4, 5493),
    food('food_mayonnaise', 'Mayonez', 'extra', 680, 1, 0.6, 75, 0, 0.6, 635),
    food('food_ketchup', 'Ketçap', 'extra', 112, 1.3, 26, 0.2, 0.3, 22.8, 907),
    food('food_mustard', 'Hardal', 'extra', 66, 4.4, 5.8, 4.4, 3.3, 1.4, 1135),
    food('food_tomato_paste', 'Domates Salçası', 'extra', 82, 4.3, 19, 0.5, 4.1, 12.2, 59),
    food('food_vinegar', 'Sirke', 'extra', 18, 0, 0.04, 0, 0, 0.04, 2),
    food('food_cooking_cream', 'Yemeklik Krema', 'extra', 190, 2.5, 3.5, 19, 0, 3.5, 40, {
        confidence: 'estimated',
        source: LABEL_SOURCE
    }),
    food('food_bechamel_standard', 'Beşamel Sos (Standart)', 'extra', 105, 3.3, 9, 6.5, 0.3, 4.5, 330, {
        confidence: 'estimated',
        source: 'Standart ev tipi tarif ortalaması'
    }),

    // Ek et, balık, süt ürünü ve bitkisel proteinler
    food('food_chicken_wing_roasted', 'Tavuk Kanat (Fırınlanmış)', 'protein', 266, 24, 0, 19, 0, 0, 89),
    food('food_lamb_leg_roasted', 'Kuzu But (Pişmiş)', 'protein', 258, 25.6, 0, 16.5, 0, 0, 65),
    food('food_beef_liver_cooked', 'Dana Ciğeri (Pişmiş)', 'protein', 191, 29.1, 5.1, 5.3, 0, 0, 79),
    food('food_meatball_plain', 'Dana Köfte (Sade)', 'protein', 250, 24, 8, 14, 0.5, 1, 520, {
        confidence: 'estimated',
        source: 'Standart dana köfte tarifi ortalaması'
    }),
    food('food_sucuk', 'Sucuk', 'protein', 452, 21, 2, 40, 0, 1, 1700, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_turkey_smoked', 'Hindi Füme', 'protein', 104, 17, 4, 2, 0, 1, 1200, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_tuna_fresh_cooked', 'Orkinos (Pişmiş)', 'protein', 184, 29.9, 0, 6.3, 0, 0, 50),
    food('food_shrimp_cooked', 'Karides (Pişmiş)', 'protein', 99, 24, 0.2, 0.3, 0, 0, 111),
    food('food_mussels_cooked', 'Midye Eti (Pişmiş)', 'protein', 172, 23.8, 7.4, 4.5, 0, 0, 369),
    food('food_anchovy_cooked', 'Hamsi (Pişmiş)', 'protein', 210, 28.9, 0, 9.7, 0, 0, 104),
    food('food_salmon_smoked', 'Somon Füme', 'protein', 117, 18.3, 0, 4.3, 0, 0, 672),
    food('food_tofu_firm', 'Tofu (Sert)', 'protein', 144, 17.3, 2.8, 8.7, 2.3, 0.6, 14),
    food('food_tempeh_cooked', 'Tempeh (Pişmiş)', 'protein', 195, 19.9, 7.6, 11.4, 3.9, 0, 14),
    food('food_edamame_cooked', 'Edamame (Pişmiş)', 'protein', 121, 11.9, 8.9, 5.2, 5.2, 2.2, 6),
    food('food_black_beans_cooked', 'Siyah Fasulye (Pişmiş)', 'protein', 132, 8.9, 23.7, 0.5, 8.7, 0.3, 1),
    food('food_red_lentils_cooked', 'Kırmızı Mercimek (Pişmiş)', 'protein', 116, 9, 20.1, 0.4, 7.9, 1.8, 2),
    food('food_mozzarella', 'Mozzarella Peyniri', 'protein', 280, 28, 3.1, 17, 0, 1, 627),
    food('food_cream_cheese', 'Krem Peynir', 'protein', 342, 6.2, 4.1, 34.4, 0, 3.2, 321),
    food('food_labneh', 'Labne', 'protein', 200, 6, 5, 18, 0, 4, 360, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_whey_protein', 'Whey Protein Tozu', 'protein', 400, 80, 8, 6, 0, 4, 250, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması',
        portion_grams: 25
    }),

    // Ek tahıl, ekmek ve nişastalı ürünler
    food('food_bread_rye', 'Çavdar Ekmeği', 'carb', 259, 8.5, 48.3, 3.3, 5.8, 3.9, 603, { slice_grams: 28 }),
    food('food_pita', 'Pide Ekmeği', 'carb', 275, 9.1, 55.7, 1.2, 2.2, 1.3, 536),
    food('food_simit', 'Simit', 'carb', 340, 10, 57, 8, 3, 4, 600, {
        confidence: 'estimated',
        source: 'Standart fırın ürünü ortalaması',
        piece_grams: 100
    }),
    food('food_bazlama', 'Bazlama', 'carb', 270, 8.5, 53, 2.5, 2.5, 2, 560, {
        confidence: 'estimated',
        source: 'Standart fırın ürünü ortalaması',
        piece_grams: 150
    }),
    food('food_couscous_cooked', 'Kuskus (Pişmiş)', 'carb', 112, 3.8, 23.2, 0.2, 1.4, 0.1, 5),
    food('food_barley_cooked', 'Arpa (Pişmiş)', 'carb', 123, 2.3, 28.2, 0.4, 3.8, 0.3, 3),
    food('food_buckwheat_cooked', 'Karabuğday (Pişmiş)', 'carb', 92, 3.4, 19.9, 0.6, 2.7, 0.9, 4),
    food('food_polenta_cooked', 'Mısır Lapası (Pişmiş)', 'carb', 70, 1.4, 15, 0.4, 0.8, 0.1, 152),
    food('food_corn_flakes', 'Mısır Gevreği', 'carb', 357, 7.5, 84.1, 0.4, 3.3, 10, 729),
    food('food_granola_plain', 'Granola (Sade)', 'carb', 471, 10, 64, 20, 8, 20, 190, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_rice_cake', 'Pirinç Patlağı', 'carb', 387, 8, 81.5, 2.8, 4.2, 0.9, 326, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_cracker_wholegrain', 'Tam Tahıllı Kraker', 'carb', 430, 10, 67, 14, 7, 7, 620, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_flour_wheat', 'Buğday Unu', 'carb', 364, 10.3, 76.3, 1, 2.7, 0.3, 2),
    food('food_semolina_dry', 'İrmik (Kuru)', 'carb', 360, 12.7, 72.8, 1.1, 3.9, 0.4, 1),
    food('food_noodles_cooked', 'Erişte (Pişmiş)', 'carb', 138, 4.5, 25.2, 2.1, 1.2, 0.7, 5),
    food('food_french_fries', 'Patates Kızartması', 'carb', 312, 3.4, 41.4, 15, 3.8, 0.3, 210, {
        confidence: 'estimated',
        source: 'Standart restoran ürünü ortalaması'
    }),
    food('food_mashed_potato', 'Patates Püresi (Sade)', 'carb', 88, 1.7, 17, 2.8, 1.3, 1.4, 250, {
        confidence: 'estimated',
        source: 'Standart sütlü tarif ortalaması'
    }),
    food('food_popcorn_air', 'Patlamış Mısır (Yağsız)', 'carb', 387, 12.9, 77.8, 4.5, 14.5, 0.9, 8),
    food('food_chestnut_roasted', 'Kestane (Kavrulmuş)', 'carb', 245, 3.2, 53, 2.2, 5.1, 10.6, 2),

    // Ek sebzeler, otlar ve kökler
    food('food_leek_raw', 'Pırasa', 'vegetable', 61, 1.5, 14.2, 0.3, 1.8, 3.9, 20),
    food('food_chard_raw', 'Pazı', 'vegetable', 19, 1.8, 3.7, 0.2, 1.6, 1.1, 213),
    food('food_okra_raw', 'Bamya', 'vegetable', 33, 1.9, 7.5, 0.2, 3.2, 1.5, 7),
    food('food_artichoke_raw', 'Enginar', 'vegetable', 47, 3.3, 10.5, 0.2, 5.4, 1, 94),
    food('food_asparagus_raw', 'Kuşkonmaz', 'vegetable', 20, 2.2, 3.9, 0.1, 2.1, 1.9, 2),
    food('food_brussels_sprouts_raw', 'Brüksel Lahanası', 'vegetable', 43, 3.4, 9, 0.3, 3.8, 2.2, 25),
    food('food_radish_raw', 'Turp', 'vegetable', 16, 0.7, 3.4, 0.1, 1.6, 1.9, 39),
    food('food_pumpkin_raw', 'Balkabağı', 'vegetable', 26, 1, 6.5, 0.1, 0.5, 2.8, 1),
    food('food_turnip_raw', 'Şalgam (Sebze)', 'vegetable', 28, 0.9, 6.4, 0.1, 1.8, 3.8, 67),
    food('food_coriander_raw', 'Taze Kişniş', 'vegetable', 23, 2.1, 3.7, 0.5, 2.8, 0.9, 46),
    food('food_ginger_raw', 'Taze Zencefil', 'vegetable', 80, 1.8, 17.8, 0.8, 2, 1.7, 13),
    food('food_fennel_raw', 'Rezene', 'vegetable', 31, 1.2, 7.3, 0.2, 3.1, 3.9, 52),
    food('food_watercress_raw', 'Tere', 'vegetable', 11, 2.3, 1.3, 0.1, 0.5, 0.2, 41),
    food('food_celery_root_raw', 'Kereviz Kökü', 'vegetable', 42, 1.5, 9.2, 0.3, 1.8, 1.6, 100),
    food('food_snow_peas_raw', 'Sultani Bezelye', 'vegetable', 42, 2.8, 7.6, 0.2, 2.6, 4, 4),

    // Ek taze ve kuru meyveler
    food('food_pear_raw', 'Armut', 'fruit', 57, 0.4, 15.2, 0.1, 3.1, 9.8, 1, { piece_grams: 178 }),
    food('food_mandarin_raw', 'Mandalina', 'fruit', 53, 0.8, 13.3, 0.3, 1.8, 10.6, 2, { piece_grams: 88 }),
    food('food_watermelon_raw', 'Karpuz', 'fruit', 30, 0.6, 7.6, 0.2, 0.4, 6.2, 1),
    food('food_melon_raw', 'Kavun', 'fruit', 34, 0.8, 8.2, 0.2, 0.9, 7.9, 16),
    food('food_cherry_raw', 'Kiraz', 'fruit', 63, 1.1, 16, 0.2, 2.1, 12.8, 0),
    food('food_sour_cherry_raw', 'Vişne', 'fruit', 50, 1, 12.2, 0.3, 1.6, 8.5, 3),
    food('food_plum_raw', 'Erik', 'fruit', 46, 0.7, 11.4, 0.3, 1.4, 9.9, 0),
    food('food_apricot_raw', 'Kayısı', 'fruit', 48, 1.4, 11.1, 0.4, 2, 9.2, 1),
    food('food_pomegranate_raw', 'Nar', 'fruit', 83, 1.7, 18.7, 1.2, 4, 13.7, 3),
    food('food_fig_raw', 'İncir', 'fruit', 74, 0.8, 19.2, 0.3, 2.9, 16.3, 1),
    food('food_date_dried', 'Hurma (Kuru)', 'fruit', 282, 2.5, 75, 0.4, 8, 63.4, 2),
    food('food_apricot_dried', 'Kuru Kayısı', 'fruit', 241, 3.4, 62.6, 0.5, 7.3, 53.4, 10),
    food('food_raisins', 'Kuru Üzüm', 'fruit', 299, 3.1, 79.2, 0.5, 3.7, 59.2, 11),
    food('food_mango_raw', 'Mango', 'fruit', 60, 0.8, 15, 0.4, 1.6, 13.7, 1),
    food('food_grapefruit_raw', 'Greyfurt', 'fruit', 42, 0.8, 10.7, 0.1, 1.6, 6.9, 0),
    food('food_raspberry_raw', 'Ahududu', 'fruit', 52, 1.2, 11.9, 0.7, 6.5, 4.4, 1),
    food('food_blackberry_raw', 'Böğürtlen', 'fruit', 43, 1.4, 9.6, 0.5, 5.3, 4.9, 1),
    food('food_persimmon_raw', 'Trabzon Hurması', 'fruit', 70, 0.6, 18.6, 0.2, 3.6, 12.5, 1),

    // Ek yağlar, kuruyemişler, tatlandırıcılar ve atıştırmalıklar
    food('food_olive_black', 'Siyah Zeytin', 'fat', 116, 0.8, 6, 10.9, 1.6, 0, 735),
    food('food_olive_green', 'Yeşil Zeytin', 'fat', 145, 1, 3.8, 15.3, 3.3, 0.5, 1556),
    food('food_tahini', 'Tahin', 'fat', 595, 17, 21.2, 53.8, 9.3, 0.5, 115),
    food('food_sunflower_seeds', 'Ayçiçeği Çekirdeği', 'fat', 584, 20.8, 20, 51.5, 8.6, 2.6, 9),
    food('food_pumpkin_seeds', 'Kabak Çekirdeği', 'fat', 559, 30.2, 10.7, 49.1, 6, 1.4, 7),
    food('food_cashews_raw', 'Kaju', 'fat', 553, 18.2, 30.2, 43.9, 3.3, 5.9, 12),
    food('food_pistachios_raw', 'Antep Fıstığı', 'fat', 562, 20.2, 27.2, 45.3, 10.6, 7.7, 1),
    food('food_coconut_oil', 'Hindistan Cevizi Yağı', 'fat', 892, 0, 0, 100, 0, 0, 0),
    food('food_honey', 'Bal', 'extra', 304, 0.3, 82.4, 0, 0.2, 82.1, 4),
    food('food_grape_molasses', 'Üzüm Pekmezi', 'extra', 290, 0.5, 72, 0.1, 0, 65, 20, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_jam', 'Reçel', 'extra', 250, 0.4, 65, 0.1, 1, 60, 20, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_chocolate_dark_70', 'Bitter Çikolata (%70)', 'extra', 598, 7.8, 45.9, 42.6, 10.9, 24, 20),
    food('food_chocolate_milk', 'Sütlü Çikolata', 'extra', 535, 7.7, 59.4, 29.7, 3.4, 51.5, 79),
    food('food_cocoa_powder', 'Kakao Tozu (Şekersiz)', 'extra', 228, 19.6, 57.9, 13.7, 33.2, 1.8, 21),
    food('food_hazelnut_spread', 'Kakaolu Fındık Kreması', 'extra', 539, 6.3, 57.5, 30.9, 3.4, 54.4, 41, {
        confidence: 'estimated',
        source: 'Yaygın ürün etiketi ortalaması'
    }),
    food('food_corn_starch', 'Mısır Nişastası', 'extra', 381, 0.3, 91.3, 0.1, 0.9, 0, 9)
];
