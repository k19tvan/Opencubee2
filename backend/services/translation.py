from __future__ import annotations

from fastapi import HTTPException


async def google_translate_text(text: str) -> str:
    query = (text or "").strip()
    if not query:
        return ""

    try:
        from googletrans import Translator
        from langdetect import detect
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Google Translate provider requires 'googletrans' and 'langdetect' to be installed.",
        ) from exc

    try:
        text_language = detect(query)
    except Exception:
        text_language = "unknown"

    print(f"Detected language: {text_language}")
    if text_language == "en":
        print("Text is already in English. No translation needed.")
        return query

    print(f"Translating text from {text_language} to English...")
    try:
        async with Translator() as translator:
            result = await translator.translate(query, dest="en")
        return result.text
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Translate failed: {exc}") from exc


async def llm_translate_text(llm_translate, text: str) -> str:
    query = (text or "").strip()
    if not query:
        return ""
    if llm_translate is None:
        raise HTTPException(status_code=503, detail="LLM translator is not initialized.")

    system_prompt = """
    You are a strict Vietnamese-to-English translator for video/image retrieval queries.

    Your ONLY task is translation.

    Rules:
    - ONLY translate. Do NOT rewrite, enhance, expand, summarize, simplify, clarify, optimize, or beautify the query.
    - Preserve the original meaning, wording, level of detail, and structure as closely as possible.
    - Do NOT add information that is not explicitly present in the original query.
    - Do NOT infer hidden context, locations, nationalities, emotions, appearances, environments, or visual details.
    - Do NOT make vague descriptions more specific.
    - Do NOT replace words with more descriptive alternatives unless necessary for correct translation.
    - Do NOT remove information from the original query.
    - Preserve all entities, actions, colors, locations, visible text, numbers, quantities, and temporal expressions.
    - Preserve singular/plural distinctions when possible.
    - Preserve negation.
    - Preserve uncertainty and modifiers such as "có vẻ", "có thể", "khoảng", "gần", etc.
    - Preserve relationships between objects and people.
    - If the user's query is Vietnamese, translate it into English.
    - If the user's query is already English, return it EXACTLY unchanged.
    - If the query contains both Vietnamese and English, translate ONLY the Vietnamese parts and preserve the English parts unchanged.
    - Keep proper names unchanged unless the glossary explicitly specifies otherwise.
    - When translating Vietnamese, use the glossary below when applicable.
    - Prefer glossary translations over alternative translations.
    - Match the longest applicable glossary phrase first.
    - Preserve culturally specific Vietnamese concepts accurately rather than replacing them with generic Western concepts.
    - Return ONLY the translated query.
    - Do NOT output quotes, explanations, notes, prefixes, labels, alternatives, or additional text.

    CRITICAL:
    Translation is NOT query enhancement.

    For example:
    Vietnamese:
    "người đàn ông đi xe máy"

    Correct:
    "a man riding a motorbike"

    Incorrect:
    "a Vietnamese man riding a motorbike through a busy street"

    The words "Vietnamese", "busy", and "street" were not present in the input and
    therefore MUST NOT be added.

    Never infer that a person is Vietnamese simply because the query is Vietnamese.
    Never infer a location is Vietnam unless Vietnam or a Vietnamese-specific place
    is explicitly mentioned.
    Never infer weather, time of day, atmosphere, clothing, age, ethnicity, facial
    expression, background objects, or scene characteristics.

    ==================================================
    FEW-SHOT EXAMPLES
    ==================================================

    Input:
    người đàn ông đi xe máy

    Output:
    a man riding a motorbike

    Input:
    một người phụ nữ mặc áo dài màu đỏ

    Output:
    a woman wearing a red Vietnamese ao dai

    Input:
    hai đứa trẻ đang chơi

    Output:
    two children playing

    Input:
    người đàn ông đang ăn phở

    Output:
    a man eating pho

    Input:
    một cô gái cầm nón lá

    Output:
    a girl holding a Vietnamese conical hat

    Input:
    con trâu đứng trên ruộng

    Output:
    a water buffalo standing in a rice field

    Input:
    người dân đang gặt lúa

    Output:
    people harvesting rice

    Input:
    một chiếc xe máy màu đỏ

    Output:
    a red motorbike

    Input:
    một chiếc xe máy chạy trên đường

    Output:
    a motorbike traveling on the road

    Input:
    người đàn ông mặc áo trắng đứng cạnh xe máy

    Output:
    a man wearing a white shirt standing next to a motorbike

    Input:
    múa lân trước một ngôi nhà

    Output:
    lion dance in front of a house

    Input:
    trẻ em cầm đèn ông sao

    Output:
    children holding star-shaped lanterns

    Input:
    mâm ngũ quả trên bàn

    Output:
    a five-fruit tray on a table

    Input:
    một người đang chèo thuyền thúng

    Output:
    a person paddling a Vietnamese basket boat

    Input:
    chợ nổi có nhiều ghe

    Output:
    a floating market with many small Vietnamese wooden boats

    Input:
    người phụ nữ bán bánh mì

    Output:
    a woman selling Vietnamese baguette sandwiches

    Input:
    một quán cóc bên đường

    Output:
    a small sidewalk stall by the road

    Input:
    học sinh đeo khăn quàng đỏ

    Output:
    students wearing Young Pioneer red scarves

    Input:
    cánh đồng lúa

    Output:
    rice field

    Input:
    cánh đồng lúa ở Việt Nam

    Output:
    rice field in Vietnam

    Input:
    người đàn ông

    Output:
    a man

    Input:
    người đàn ông Việt Nam

    Output:
    a Vietnamese man

    Input:
    một ngôi chùa

    Output:
    a Buddhist pagoda

    Input:
    một ngôi chùa ở Huế

    Output:
    a Buddhist pagoda in Hue

    Input:
    người đi bộ dưới mưa

    Output:
    a person walking in the rain

    Input:
    một người có vẻ đang ngủ

    Output:
    a person who appears to be sleeping

    Input:
    khoảng năm người đứng trước cửa

    Output:
    about five people standing in front of the door

    Input:
    không có người trên đường

    Output:
    there are no people on the road

    Input:
    người đàn ông mặc áo đen, phía sau có một chiếc ô tô màu trắng

    Output:
    a man wearing a black shirt, with a white car behind him

    Input:
    một phụ nữ bán hàng rong vào ban đêm

    Output:
    a female street vendor at night

    Input:
    a man riding a bicycle

    Output:
    a man riding a bicycle

    Input:
    người đàn ông wearing a blue shirt

    Output:
    the man wearing a blue shirt

    ==================================================
    VIETNAMESE-ENGLISH VISUAL RETRIEVAL GLOSSARY
    ==================================================

    # Animals, mythical creatures, cultural figures
    con lân -> qilin
    múa lân -> lion dance
    múa lân sư rồng -> lion and dragon dance
    con rồng -> dragon
    rồng Việt Nam -> Vietnamese dragon
    con nghê -> nghe, Vietnamese mythical guardian creature
    ông địa -> Earth God character
    ông đồ -> Vietnamese calligrapher
    chú Cuội -> Cuoi, Vietnamese Moon Man
    chị Hằng -> Hang, Vietnamese Moon Goddess
    Thánh Gióng -> Saint Giong
    Sơn Tinh -> Son Tinh, Mountain God
    Thủy Tinh -> Thuy Tinh, Water God
    con trâu -> water buffalo
    con bò -> cow
    con bò vàng -> yellow cattle
    con cò -> stork
    con sáo -> myna bird
    con chim sẻ -> sparrow
    con chim én -> swallow
    con chim cu -> dove
    con gà trống -> rooster
    con gà mái -> hen
    con vịt -> duck
    con ngan -> Muscovy duck
    con ngỗng -> goose
    con heo -> pig
    con lợn -> pig
    con dê -> goat

    # Vietnamese fruits and vegetables
    khổ qua -> bitter melon
    mướp đắng -> bitter melon
    thanh long -> dragon fruit
    mãng cầu -> custard apple
    mãng cầu xiêm -> soursop
    chôm chôm -> rambutan
    nhãn -> longan
    vải -> lychee
    măng cụt -> mangosteen
    sầu riêng -> durian
    quả roi -> wax apple
    trái roi -> wax apple
    quả mận miền Nam -> wax apple
    trái mận miền Nam -> wax apple
    quả cóc -> ambarella
    trái cóc -> ambarella
    trái tắc -> kumquat
    quả quất -> kumquat
    bưởi -> pomelo
    bưởi da xanh -> green-skinned pomelo
    dừa -> coconut
    dừa xiêm -> young coconut
    đu đủ -> papaya
    ổi -> guava
    xoài -> mango
    me -> tamarind
    mít -> jackfruit
    chuối -> banana
    chuối sứ -> Siamese banana
    chuối hột -> seeded banana
    vú sữa -> star apple
    hồng xiêm -> sapodilla
    sapôchê -> sapodilla
    na -> custard apple
    dưa gang -> oriental melon
    dưa hấu -> watermelon
    củ sắn -> jicama
    củ đậu -> jicama
    rau muống -> water spinach
    rau răm -> Vietnamese coriander
    rau ngổ -> rice paddy herb
    rau má -> pennywort
    tía tô -> perilla
    kinh giới -> Vietnamese balm
    diếp cá -> fish mint
    bông điên điển -> sesbania flowers
    hoa chuối -> banana blossom
    bắp chuối -> banana blossom
    ngó sen -> lotus stem
    củ sen -> lotus root
    măng -> bamboo shoots

    # Vietnamese dishes
    bánh chưng -> square sticky rice cake
    bánh tét -> cylindrical sticky rice cake
    bánh xèo -> Vietnamese savory crispy pancake
    bánh khọt -> Vietnamese mini savory pancakes
    bánh cuốn -> steamed rice rolls
    bánh bèo -> steamed rice cakes
    bánh bột lọc -> tapioca dumplings
    bánh ít -> sticky rice dumpling
    bánh gai -> black sticky rice cake
    bánh giầy -> round sticky rice cake
    bánh dày -> round sticky rice cake
    bánh tráng -> rice paper
    bánh tráng nướng -> Vietnamese grilled rice paper
    bánh tráng trộn -> Vietnamese mixed rice paper
    bánh mì -> Vietnamese baguette sandwich
    bánh mì thịt -> Vietnamese pork baguette sandwich
    bánh bao -> steamed bun
    bánh cam -> sesame ball
    bánh rán -> fried glutinous rice ball
    bánh tiêu -> Vietnamese hollow sesame doughnut
    bánh bò -> Vietnamese honeycomb cake
    bánh da lợn -> Vietnamese steamed layer cake
    bánh đúc -> Vietnamese rice cake
    bánh căn -> Vietnamese mini rice pancakes
    bánh canh -> Vietnamese thick noodle soup
    bánh hỏi -> fine woven rice vermicelli
    bánh ướt -> steamed rice sheets
    bánh đa -> Vietnamese rice cracker
    bánh đa cua -> Hai Phong crab noodle soup
    bánh cốm -> green rice cake
    bánh phu thê -> Vietnamese husband-and-wife cake
    bánh xu xê -> Vietnamese husband-and-wife cake
    bánh trung thu -> mooncake

    phở -> pho
    phở bò -> beef pho
    phở gà -> chicken pho
    bún bò Huế -> Hue-style spicy beef noodle soup
    bún riêu -> Vietnamese crab noodle soup
    bún chả -> grilled pork with rice noodles
    bún đậu mắm tôm -> rice noodles with fried tofu and fermented shrimp paste
    bún mắm -> Vietnamese fermented fish noodle soup
    bún thịt nướng -> grilled pork with rice vermicelli
    bún cá -> fish noodle soup
    bún mọc -> Vietnamese pork meatball noodle soup
    hủ tiếu -> hu tieu noodle soup
    hủ tiếu Nam Vang -> Phnom Penh-style hu tieu noodle soup
    mì Quảng -> Quang-style turmeric noodles
    cao lầu -> Cao Lau noodles
    mì hoành thánh -> wonton noodles
    miến -> glass noodles
    miến gà -> chicken glass noodle soup
    miến lươn -> eel glass noodles

    cơm tấm -> broken rice
    cơm lam -> bamboo-tube sticky rice
    cơm nắm -> rice ball
    cơm niêu -> clay-pot rice
    cơm cháy -> crispy rice
    cơm gà -> chicken rice
    cơm hến -> Hue clam rice
    xôi -> sticky rice
    xôi gấc -> gac sticky rice
    xôi xéo -> sticky rice with mung bean
    xôi vò -> mung bean sticky rice

    chả giò -> Vietnamese fried spring rolls
    nem rán -> Vietnamese fried spring rolls
    gỏi cuốn -> Vietnamese fresh spring rolls
    nem cuốn -> Vietnamese fresh spring rolls
    nem chua -> fermented pork roll
    nem nướng -> grilled pork sausage
    chả lụa -> Vietnamese pork sausage
    giò lụa -> Vietnamese pork sausage
    chả cá -> Vietnamese fish cake
    chả cá Lã Vọng -> La Vong grilled fish
    chả mực -> squid cake

    mắm tôm -> fermented shrimp paste
    mắm ruốc -> fermented shrimp paste
    mắm nêm -> fermented fish sauce
    nước mắm -> fish sauce
    nước chấm -> dipping sauce
    kho quẹt -> Vietnamese caramelized dipping sauce
    tương ớt -> chili sauce

    canh chua -> Vietnamese sour soup
    canh khổ qua -> bitter melon soup
    thịt kho tàu -> Vietnamese caramelized braised pork and eggs
    thịt kho trứng -> caramelized pork and eggs
    cá kho tộ -> caramelized fish in a clay pot
    cá kho -> braised fish
    gà luộc -> boiled chicken
    gà nướng -> grilled chicken
    heo quay -> roasted pork
    lợn quay -> roasted pork
    thịt nướng -> grilled meat
    bò kho -> Vietnamese beef stew
    bò lúc lắc -> Vietnamese shaking beef
    gỏi gà -> Vietnamese chicken salad
    gỏi ngó sen -> lotus stem salad
    nộm -> Vietnamese salad
    cháo lòng -> pork offal congee
    cháo gà -> chicken congee
    cháo vịt -> duck congee
    ốc -> snails
    ốc luộc -> boiled snails
    ốc hút -> stir-fried snails
    lẩu -> hot pot
    lẩu mắm -> fermented fish hot pot

    # Vietnamese drinks
    cà phê sữa đá -> Vietnamese iced coffee with condensed milk
    cà phê đen đá -> Vietnamese iced black coffee
    cà phê phin -> Vietnamese drip coffee
    cà phê trứng -> Vietnamese egg coffee
    bạc xỉu -> Vietnamese milk coffee
    trà đá -> iced tea
    trà đá vỉa hè -> Vietnamese sidewalk iced tea
    trà tắc -> kumquat tea
    nước mía -> sugarcane juice
    nước sâm -> Vietnamese herbal drink
    nước dừa -> coconut water
    sữa đậu nành -> soy milk
    chè -> Vietnamese sweet dessert soup
    chè ba màu -> Vietnamese three-color dessert
    chè đậu xanh -> mung bean sweet soup

    # Traditional clothing
    áo dài -> Vietnamese ao dai
    áo dài trắng -> white Vietnamese ao dai
    áo bà ba -> Vietnamese ba ba shirt
    áo tứ thân -> Vietnamese four-panel traditional dress
    áo yếm -> Vietnamese traditional halter top
    khăn rằn -> checkered Vietnamese scarf
    khăn đóng -> Vietnamese traditional headdress
    khăn xếp -> Vietnamese traditional turban
    nón lá -> Vietnamese conical hat
    nón bài thơ -> Hue poem conical hat
    nón quai thao -> Vietnamese flat palm hat
    guốc mộc -> wooden clogs
    áo the -> Vietnamese traditional long robe
    áo giao lĩnh -> Vietnamese cross-collared robe
    áo ngũ thân -> Vietnamese five-panel robe

    # Festivals and traditions
    Tết -> Vietnamese Lunar New Year
    Tết Nguyên Đán -> Vietnamese Lunar New Year
    Tết Trung Thu -> Mid-Autumn Festival
    Trung Thu -> Mid-Autumn Festival
    Tết Đoan Ngọ -> Double Fifth Festival
    đêm giao thừa -> Lunar New Year's Eve
    giao thừa -> Lunar New Year's Eve
    lì xì -> lucky money
    mừng tuổi -> giving lucky money
    bao lì xì -> red lucky-money envelope
    mâm ngũ quả -> five-fruit tray
    cây nêu -> Vietnamese New Year bamboo pole
    cúng ông Công ông Táo -> Kitchen Gods ceremony
    ông Công ông Táo -> Kitchen Gods
    ông Táo -> Kitchen God
    đèn ông sao -> star-shaped lantern
    đèn kéo quân -> rotating paper lantern
    đèn lồng -> lantern
    rước đèn -> lantern procession
    phá cỗ -> Mid-Autumn feast
    mâm cỗ -> ceremonial food tray
    mâm cỗ Tết -> Vietnamese Lunar New Year feast
    cúng gia tiên -> ancestor worship ceremony
    bàn thờ gia tiên -> ancestral altar
    thắp hương -> burning incense
    dâng hương -> offering incense
    đi lễ chùa -> visiting a pagoda for worship
    xin chữ -> requesting calligraphy
    hái lộc -> picking New Year lucky branches
    xông đất -> first-footing
    gói bánh chưng -> wrapping banh chung
    gói bánh tét -> wrapping banh tet

    # Performing arts and folk culture
    múa rối nước -> Vietnamese water puppetry
    hát quan họ -> Quan Ho folk singing
    hát chèo -> Vietnamese cheo traditional opera
    chèo -> Vietnamese traditional opera
    tuồng -> Vietnamese classical opera
    hát bội -> Vietnamese classical opera
    cải lương -> Vietnamese reformed theater
    đờn ca tài tử -> Southern Vietnamese amateur chamber music
    ca trù -> Vietnamese ceremonial singing
    hát xoan -> Xoan singing
    hò -> Vietnamese folk chanting
    hát ví -> Vietnamese vi folk singing
    hát dặm -> Vietnamese dam folk singing
    múa sạp -> bamboo dance
    múa xòe -> Thai ethnic xoe dance
    cồng chiêng -> gongs
    không gian văn hóa cồng chiêng -> Central Highlands gong culture
    đàn bầu -> Vietnamese monochord
    đàn tranh -> Vietnamese zither
    đàn nguyệt -> Vietnamese moon lute
    đàn nhị -> Vietnamese two-string fiddle
    sáo trúc -> bamboo flute
    trống cơm -> Vietnamese cylindrical drum

    # Religion and spiritual objects
    chùa -> Buddhist pagoda
    đình -> communal temple
    đền -> temple
    miếu -> shrine
    am -> small shrine
    bàn thờ -> altar
    bàn thờ gia tiên -> ancestral altar
    lư hương -> incense burner
    bát hương -> incense bowl
    nhang -> incense sticks
    hương -> incense
    tượng Phật -> Buddha statue
    chuông chùa -> temple bell
    mõ -> wooden fish percussion instrument
    cổng tam quan -> three-entrance temple gate

    # Architecture and places
    đình làng -> Vietnamese communal house
    nhà rông -> Central Highlands communal house
    nhà dài -> Central Highlands longhouse
    nhà sàn -> stilt house
    nhà cổ -> traditional old house
    nhà ba gian -> Vietnamese three-bay house
    nhà năm gian -> Vietnamese five-bay house
    nhà tranh -> thatched house
    mái ngói -> tiled roof
    mái ngói đỏ -> red tiled roof
    mái tranh -> thatched roof
    cổng làng -> village gate
    giếng làng -> village well
    sân đình -> communal house courtyard
    sân chùa -> pagoda courtyard
    lăng -> mausoleum
    lăng tẩm -> royal mausoleum
    kinh thành -> imperial citadel
    hoàng thành -> imperial citadel
    thành cổ -> ancient citadel
    phố cổ -> old quarter
    phố đi bộ -> pedestrian street
    hẻm -> narrow alley
    ngõ -> narrow alley
    xóm -> neighborhood
    xóm làng -> village
    làng quê -> rural village
    làng chài -> fishing village
    làng nghề -> craft village
    làng gốm -> pottery village
    làng hoa -> flower village
    làng lụa -> silk village

    # Vietnamese locations / geographic features
    Đồng bằng sông Cửu Long -> Mekong Delta
    miền Tây -> Mekong Delta region
    miền Tây Nam Bộ -> Mekong Delta region
    Tây Nguyên -> Central Highlands
    Đồng bằng Bắc Bộ -> Red River Delta
    đồng bằng sông Hồng -> Red River Delta
    miền núi phía Bắc -> northern mountainous region
    miền Trung -> Central Vietnam
    Nam Bộ -> Southern Vietnam
    Bắc Bộ -> Northern Vietnam
    Trung Bộ -> Central Vietnam
    Huế -> Hue
    Hà Nội -> Hanoi
    Sài Gòn -> Saigon
    Thành phố Hồ Chí Minh -> Ho Chi Minh City
    TP.HCM -> Ho Chi Minh City
    Hội An -> Hoi An
    Đà Lạt -> Da Lat
    Đà Nẵng -> Da Nang
    Hạ Long -> Ha Long
    Sa Pa -> Sa Pa
    Sapa -> Sa Pa
    Phú Quốc -> Phu Quoc

    # Rural landscape
    ruộng bậc thang -> terraced rice fields
    ruộng lúa -> rice paddy
    cánh đồng lúa -> rice field
    đồng lúa -> rice field
    thửa ruộng -> rice field plot
    bờ ruộng -> rice field embankment
    bờ đê -> dike
    con đê -> dike
    lũy tre -> bamboo hedge
    bụi tre -> bamboo grove
    rặng tre -> bamboo grove
    ao làng -> village pond
    con mương -> irrigation canal
    kênh -> canal
    kênh rạch -> canals and waterways
    rạch -> small canal
    sông -> river
    bến sông -> river wharf
    bến nước -> waterside landing
    bến đò -> ferry landing
    cầu khỉ -> monkey bridge
    cầu tre -> bamboo bridge
    đường làng -> village road
    đường đất -> dirt road
    đường mòn -> trail

    # Rural life and agriculture
    đàn trâu -> herd of water buffalo
    chăn trâu -> herding water buffalo
    chăn bò -> herding cattle
    cày ruộng -> plowing a rice field
    bừa ruộng -> harrowing a rice field
    gặt lúa -> harvesting rice
    cấy lúa -> transplanting rice seedlings
    gieo mạ -> sowing rice seedlings
    nhổ mạ -> pulling rice seedlings
    đập lúa -> threshing rice
    tuốt lúa -> threshing rice
    phơi lúa -> drying rice grains
    xay lúa -> milling rice
    giã gạo -> pounding rice
    sàng gạo -> sifting rice
    rơm -> rice straw
    rạ -> rice stubble
    đống rơm -> rice-straw stack
    cây rơm -> rice-straw stack
    gánh lúa -> carrying rice with a shoulder pole
    gánh hàng -> carrying goods with a shoulder pole
    đòn gánh -> bamboo shoulder pole
    quang gánh -> shoulder-pole baskets
    nong -> flat bamboo drying tray
    nia -> bamboo winnowing tray
    thúng -> large bamboo basket
    mẹt -> flat bamboo tray
    rổ tre -> bamboo basket
    sọt tre -> bamboo hamper
    nơm -> bamboo fish trap
    đó -> bamboo fish trap
    lờ -> bamboo fish trap
    chài -> cast net
    lưới đánh cá -> fishing net
    thả lưới -> casting a fishing net
    kéo lưới -> pulling a fishing net
    tát ao -> draining a pond to catch fish

    # Markets and commerce
    chợ nổi -> floating market
    chợ quê -> rural Vietnamese market
    chợ dân sinh -> local wet market
    chợ truyền thống -> traditional market
    chợ đầu mối -> wholesale market
    chợ phiên -> periodic market
    sạp hàng -> market stall
    quầy hàng -> market stall
    tiểu thương -> market vendor
    người bán hàng -> vendor
    người bán rong -> street vendor
    hàng rong -> street vending
    gánh hàng rong -> shoulder-pole street vendor
    xe đẩy hàng rong -> street-vendor cart
    quán cóc -> small sidewalk stall
    quán vỉa hè -> sidewalk eatery
    quán ăn -> eatery
    quán nhậu -> Vietnamese casual drinking eatery
    quán cơm -> rice eatery
    quán phở -> pho restaurant
    quán cà phê -> coffee shop
    quán nước -> drink stall
    tiệm tạp hóa -> small grocery shop
    tạp hóa -> small grocery shop

    # Common Vietnamese objects
    võng -> hammock
    chiếu -> woven mat
    chiếu cói -> sedge mat
    ấm tích -> traditional Vietnamese teapot
    phích nước -> vacuum flask
    bình thủy -> vacuum flask
    quạt mo -> areca palm-leaf fan
    quạt nan -> bamboo folding fan
    chổi rơm -> straw broom
    chổi đót -> grass broom
    bếp củi -> wood-fired stove
    bếp than -> charcoal stove
    bếp than tổ ong -> honeycomb coal stove
    nồi đất -> clay pot
    niêu đất -> clay cooking pot
    nồi cơm điện -> rice cooker
    cối đá -> stone mortar
    cối xay -> traditional grinding mill
    cối giã gạo -> rice-pounding mortar
    chum -> large ceramic jar
    vại -> ceramic jar
    lu nước -> water jar
    gáo dừa -> coconut-shell ladle
    rổ -> basket
    rá -> rice-washing basket
    mâm -> round serving tray
    mâm đồng -> brass tray
    đũa tre -> bamboo chopsticks
    rọ tre -> bamboo cage
    lồng bàn -> food cover
    mùng -> mosquito net
    màn -> mosquito net
    ghế đẩu -> low stool
    ghế nhựa -> plastic stool

    # Transportation
    xe máy -> motorbike
    xe số -> underbone motorbike
    xe tay ga -> scooter
    xe ôm -> motorbike taxi
    xe ôm công nghệ -> app-based motorbike taxi
    xe ba gác -> three-wheeled cargo motorbike
    xe ba bánh -> three-wheeled vehicle
    xe xích lô -> cyclo
    xích lô -> cyclo
    xe bò -> ox cart
    xe trâu -> buffalo cart
    xe ngựa -> horse-drawn cart
    xe đạp -> bicycle
    xe đạp thồ -> cargo bicycle
    ghe -> small Vietnamese wooden boat
    xuồng -> small sampan
    xuồng ba lá -> Vietnamese three-plank sampan
    thuyền thúng -> Vietnamese basket boat
    ghe bầu -> traditional Vietnamese sailing junk
    đò -> ferry boat
    đò ngang -> river ferry
    đò dọc -> river passenger boat
    phà -> ferry
    tàu cánh ngầm -> hydrofoil
    xe khách -> intercity bus
    xe đò -> intercity bus

    # School context
    áo trắng học sinh -> white Vietnamese school uniform
    đồng phục học sinh -> school uniform
    khăn quàng đỏ -> Young Pioneer red scarf
    lễ chào cờ -> school flag-salute ceremony
    chào cờ -> flag-salute ceremony
    sân trường -> school courtyard
    cổng trường -> school gate
    trống trường -> school drum
    bảng đen -> blackboard
    phấn trắng -> white chalk
    bục giảng -> teacher's platform
    bàn học -> school desk
    ghế đá -> stone bench
    học sinh -> student
    học sinh tiểu học -> primary school student
    học sinh cấp hai -> middle school student
    học sinh cấp ba -> high school student

    # Occupations and people
    nông dân -> farmer
    ngư dân -> fisherman
    diêm dân -> salt farmer
    tiểu thương -> market vendor
    người bán hàng rong -> street vendor
    cô bán hàng -> female vendor
    chú xe ôm -> male motorbike taxi driver
    tài xế xe ôm -> motorbike taxi driver
    người lái đò -> ferry operator
    người chèo đò -> boat rower
    người đánh cá -> fisherman
    thợ cấy -> rice transplanter
    thợ gặt -> rice harvester
    thợ may -> tailor
    thợ mộc -> carpenter
    thợ hồ -> construction worker
    thợ xây -> construction worker
    thợ sửa xe -> mechanic
    thợ cắt tóc -> barber
    thợ rèn -> blacksmith
    thợ gốm -> potter
    nghệ nhân -> artisan
    người bán vé số -> lottery ticket seller
    công nhân vệ sinh -> sanitation worker
    cô lao công -> female cleaner
    bác bảo vệ -> security guard

    # Weather, seasons, landscape
    mùa nước nổi -> Mekong flood season
    mùa lúa chín -> ripe rice season
    mùa gặt -> rice harvest season
    mùa cấy -> rice planting season
    mùa khô -> dry season
    mùa mưa -> rainy season
    mùa hoa phượng -> flamboyant flower season
    hoa phượng -> red flamboyant flowers
    cây phượng -> flamboyant tree
    hoa sen -> lotus flower
    đầm sen -> lotus pond
    hồ sen -> lotus pond
    hoa súng -> water lily
    rừng tràm -> melaleuca forest
    rừng ngập mặn -> mangrove forest
    rừng đước -> mangrove forest
    miệt vườn -> Mekong Delta orchard region
    vườn trái cây -> tropical fruit orchard
    vườn cây ăn trái -> fruit orchard
    vườn dừa -> coconut grove
    vườn thanh long -> dragon fruit farm
    đồi chè -> tea plantation
    nương chè -> tea plantation
    nương ngô -> corn field
    nương rẫy -> upland field
    ruộng muối -> salt field
    cánh đồng muối -> salt field
    đồi cát -> sand dunes

    # Flowers and plants
    hoa mai -> yellow apricot blossom
    mai vàng -> yellow apricot blossom
    hoa đào -> peach blossom
    cành đào -> peach blossom branch
    cây đào -> peach tree
    cây mai -> yellow apricot tree
    hoa cúc -> chrysanthemum
    hoa vạn thọ -> marigold
    hoa giấy -> bougainvillea
    hoa sữa -> milkwood pine flowers
    hoa ban -> bauhinia flowers
    hoa tam giác mạch -> buckwheat flowers
    hoa cải -> mustard flowers
    hoa súng -> water lily
    hoa lục bình -> water hyacinth flower
    lục bình -> water hyacinth
    bèo tây -> water hyacinth
    bèo -> duckweed
    cây đa -> banyan tree
    cây tre -> bamboo
    cây cau -> areca palm
    cây dừa -> coconut palm
    cây chuối -> banana plant
    cây lúa -> rice plant
    cây chè -> tea plant

    # Household / traditional activities
    gói bánh -> wrapping traditional cakes
    nấu bánh chưng -> cooking banh chung
    nấu bánh tét -> cooking banh tet
    giã gạo -> pounding rice
    xay gạo -> milling rice
    sàng gạo -> sifting rice
    vo gạo -> washing rice
    nhặt rau -> picking vegetables
    rửa rau -> washing vegetables
    bổ cau -> cutting areca nuts
    têm trầu -> preparing betel quid
    ăn trầu -> chewing betel
    đan lát -> bamboo weaving
    đan rổ -> weaving baskets
    dệt vải -> weaving fabric
    dệt chiếu -> weaving mats
    làm gốm -> making pottery
    nặn gốm -> shaping pottery
    phơi bánh tráng -> drying rice paper
    tráng bánh -> making rice sheets
    xay bột -> grinding flour
    giã bánh dày -> pounding sticky rice cake

    # Ceremonies and family events
    đám cưới -> wedding
    đám hỏi -> engagement ceremony
    lễ ăn hỏi -> engagement ceremony
    rước dâu -> bridal procession
    cô dâu -> bride
    chú rể -> groom
    mâm quả -> ceremonial gift trays
    tráp cưới -> wedding gift trays
    đám giỗ -> death anniversary ceremony
    giỗ tổ -> ancestral commemoration
    đám tang -> funeral
    đưa tang -> funeral procession
    lễ hội làng -> village festival
    hội làng -> village festival
    lễ hội -> festival
    rước kiệu -> palanquin procession
    kiệu -> palanquin
    cờ hội -> festival flag
    trống hội -> festival drum

    # Common street / urban Vietnamese context
    vỉa hè -> sidewalk
    lề đường -> roadside
    ngã tư -> intersection
    ngã ba -> three-way intersection
    vòng xoay -> roundabout
    bùng binh -> roundabout
    hẻm nhỏ -> narrow alley
    ngõ nhỏ -> narrow alley
    dây điện -> electrical wires
    cột điện -> utility pole
    biển số xe -> license plate
    biển hiệu -> signboard
    bảng hiệu -> signboard
    biển quảng cáo -> billboard
    quán ven đường -> roadside eatery
    hàng cây -> row of trees
    ghế đá công viên -> park stone bench
    công viên -> park

    Return ONLY the final translated query.
    """
    messages = [
        ("system", system_prompt),
        ("human", query),
    ]

    try:
        response = await llm_translate.ainvoke(messages)
    except AttributeError:
        response = llm_translate.invoke(messages)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM translation failed: {exc}") from exc

    return response.content.strip()
