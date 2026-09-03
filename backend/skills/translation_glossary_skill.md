# Từ điển Đối chiếu & Chuẩn hóa Dịch thuật Thị giác Việt - Anh (Visual Translation Glossary Skill)

## Vai trò & Mục đích
Kỹ năng này cung cấp hệ thống từ vựng đối chiếu chuyên sâu (Glossary) và quy tắc dịch thuật thị giác chuẩn xác từ Tiếng Việt sang Tiếng Anh cho các mô hình truy xuất video/hình ảnh (Visual Retrieval Models như FG-CLIP2, BEiT3, BGE).

---

## 1. Các Nguyên tắc Dịch thuật Thị giác Cốt lõi (Core Visual Translation Rules)

1. **CHỈ DỊCH - KHÔNG TỰ SUY DIỄN / THÊM BỚT (Strict Translation, No Hallucination)**:
   - Giữ nguyên cấu trúc, mức độ chi tiết và đối tượng của truy vấn gốc.
   - **TUYỆT ĐỐI KHÔNG** tự ý thêm quốc tịch ("Vietnamese"), tính từ cảm xúc ("busy", "peaceful", "beautiful"), hay chi tiết bối cảnh không có trong câu gốc.
   - *Ví dụ*: `"người đàn ông đi xe máy"` -> `"a man riding a motorbike"` *(SAI: "a Vietnamese man riding a motorbike on a busy street")*.

2. **BẢO TỒN ĐẶC TRƯNG VĂN HÓA & TRANG PHỤC VIỆT NAM (Cultural Entities)**:
   - Các thực thể văn hóa, trang phục, món ăn truyền thống phải được dịch sang thuật ngữ chuẩn xác trong không gian embedding quốc tế (kết hợp tên gốc + mô tả thuộc tính).
   - *Ví dụ*:
     - `áo dài` -> `Vietnamese ao dai`
     - `nón lá` -> `Vietnamese conical hat`
     - `bánh mì` -> `Vietnamese baguette sandwich`
     - `phở` -> `pho / beef pho`
     - `thuyền thúng` -> `Vietnamese basket boat`
     - `chợ nổi` -> `floating market`

3. **ƯU TIÊN CỤM TỪ DÀI NHẤT TRƯỚC (Longest Phrase Matching First)**:
   - Khi dịch, luôn khớp các cụm từ ghép đầy đủ trước khi dịch từng từ đơn lẻ.
   - *Ví dụ*: Khớp `hoa mai vàng` -> `yellow apricot blossom` trước khi dịch riêng `hoa` và `mai`.

---

## 2. Bảng Tra cứu Từ vựng Chuyên sâu theo Chủ đề (Visual Vocabulary Glossary)

### A. Động vật, Sinh vật Huyền thoại & Nhân vật Dân gian (Animals & Folk Figures)
- `con lân / múa lân` -> `qilin`
- `múa lân sư rồng` -> `lion and dragon dance`
- `con rồng` -> `dragon`
- `con nghê` -> `nghe, Vietnamese mythical guardian creature`
- `ông địa` -> `Earth God character`
- `ông đồ` -> `Vietnamese calligrapher`
- `chú Cuội / chị Hằng` -> `Cuoi, Moon Man / Hang, Moon Goddess`
- `Thánh Gióng` -> `Saint Giong`
- `con trâu / đàn trâu` -> `water buffalo / herd of water buffalo`
- `con bò / bò vàng` -> `cow / yellow cattle`
- `con cò` -> `stork`
- `con chim sẻ / chim én / chim cu` -> `sparrow / swallow / dove`
- `con gà trống / gà mái / gà con` -> `rooster / hen / chick`
- `con vịt / con ngan / con ngỗng` -> `duck / Muscovy duck / goose`
- `con heo / con lợn` -> `pig`
- `con dê` -> `goat`

### B. Trái cây, Rau củ & Nông sản (Fruits, Vegetables & Produce)
- `khổ qua / mướp đắng` -> `bitter melon`
- `thanh long / vườn thanh long` -> `dragon fruit / dragon fruit farm`
- `mãng cầu / na` -> `custard apple`
- `mãng cầu xiêm` -> `soursop`
- `chôm chôm / nhãn / vải` -> `rambutan / longan / lychee`
- `măng cụt / sầu riêng` -> `mangosteen / durian`
- `quả roi / trái mận (miền Nam)` -> `wax apple`
- `quả cóc / trái tắc / quả quất` -> `ambarella / kumquat`
- `bưởi / bưởi da xanh` -> `pomelo / green-skinned pomelo`
- `dừa / dừa xiêm / vườn dừa` -> `coconut / young coconut / coconut grove`
- `đu đủ / ổi / xoài / me / mít` -> `papaya / guava / mango / tamarind / jackfruit`
- `chuối / chuối sứ / bắp chuối / hoa chuối` -> `banana / Siamese banana / banana blossom`
- `vú sữa / hồng xiêm / sapôchê` -> `star apple / sapodilla`
- `dưa hấu / dưa gang / củ đậu / củ sắn` -> `watermelon / oriental melon / jicama`
- `rau muống / rau răm / rau ngổ / rau má` -> `water spinach / Vietnamese coriander / rice paddy herb / pennywort`
- `tía tô / kinh giới / diếp cá` -> `perilla / Vietnamese balm / fish mint`
- `ngó sen / củ sen / hoa sen / đầm sen` -> `lotus stem / lotus root / lotus flower / lotus pond`
- `hoa súng / hoa lục bình / bèo tây` -> `water lily / water hyacinth / duckweed`
- `măng / măng tre` -> `bamboo shoots`

### C. Món ăn, Ẩm thực & Đồ uống (Food, Cuisine & Drinks)
- `bánh chưng / gói bánh chưng` -> `square sticky rice cake / wrapping banh chung`
- `bánh tét / gói bánh tét` -> `cylindrical sticky rice cake / wrapping banh tet`
- `bánh xèo / bánh khọt / bánh căn` -> `Vietnamese savory crispy pancake / mini savory pancakes`
- `bánh cuốn / bánh ướt` -> `steamed rice rolls / steamed rice sheets`
- `bánh bèo / bánh bột lọc / bánh ít` -> `steamed rice cakes / tapioca dumplings / sticky rice dumpling`
- `bánh tráng / bánh tráng nướng / bánh tráng trộn` -> `rice paper / Vietnamese grilled rice paper / mixed rice paper`
- `bánh mì / bánh mì thịt / bánh mì que` -> `Vietnamese baguette sandwich / pork baguette sandwich`
- `bánh bao / bánh tiêu / bánh bò / bánh da lợn` -> `steamed bun / hollow sesame doughnut / honeycomb cake / steamed layer cake`
- `bánh trung thu` -> `mooncake`
- `phở / phở bò / phở gà` -> `pho / beef pho / chicken pho`
- `bún bò Huế / bún riêu / bún chả` -> `Hue-style beef noodle soup / crab noodle soup / grilled pork with rice noodles`
- `bún đậu mắm tôm` -> `rice noodles with fried tofu and fermented shrimp paste`
- `bún thịt nướng / bún mắm / bún cá / bún mọc` -> `grilled pork rice vermicelli / fermented fish noodle soup / fish noodle soup`
- `hủ tiếu / hủ tiếu Nam Vang` -> `hu tieu noodle soup / Phnom Penh hu tieu`
- `mì Quảng / cao lầu / miến gà / miến lươn` -> `Quang turmeric noodles / Cao Lau noodles / chicken glass noodles / eel glass noodles`
- `cơm tấm / cơm sườn` -> `broken rice / broken rice with grilled pork chop`
- `cơm niêu / cơm cháy / cơm lam / cơm hến` -> `clay-pot rice / crispy rice / bamboo-tube sticky rice / Hue clam rice`
- `xôi / xôi gấc / xôi xéo / xôi vò` -> `sticky rice / gac sticky rice / mung bean sticky rice`
- `chả giò / nem rán / gỏi cuốn / nem cuốn` -> `Vietnamese fried spring rolls / fresh spring rolls`
- `chả lụa / giò lụa / nem chua / nem nướng` -> `Vietnamese pork sausage / fermented pork roll / grilled pork sausage`
- `chả cá / chả cá Lã Vọng / chả mực` -> `fish cake / La Vong grilled fish / squid cake`
- `thịt kho tàu / thịt kho trứng / cá kho tộ` -> `Vietnamese caramelized braised pork and eggs / caramelized fish in clay pot`
- `canh chua / bò kho / bò lúc lắc` -> `Vietnamese sour soup / Vietnamese beef stew / shaking beef`
- `cháo lòng / cháo gà / cháo vịt` -> `pork offal congee / chicken congee / duck congee`
- `ốc luộc / ốc hút / lẩu / lẩu mắm` -> `boiled snails / stir-fried snails / hot pot / fermented fish hot pot`
- `cà phê sữa đá / cà phê đen đá / cà phê phin / cà phê trứng` -> `Vietnamese iced coffee with condensed milk / iced black coffee / drip coffee / egg coffee`
- `bạc xỉu / trà đá vỉa hè / trà tắc / nước mía / nước dừa` -> `Vietnamese milk coffee / sidewalk iced tea / kumquat tea / sugarcane juice / coconut water`
- `chè / chè ba màu / chè đậu xanh` -> `Vietnamese sweet dessert soup / three-color sweet soup`

### D. Trang phục & Phụ kiện Truyền thống (Traditional Clothing)
- `áo dài / áo dài trắng / áo dài cách tân` -> `Vietnamese ao dai / white Vietnamese ao dai / modern ao dai`
- `áo bà ba / khăn rằn` -> `Vietnamese ba ba shirt / checkered scarf`
- `áo tứ thân / áo yếm` -> `Vietnamese four-panel traditional dress / traditional halter top`
- `khăn đóng / khăn xếp` -> `Vietnamese traditional headdress / turban`
- `nón lá / nón bài thơ / nón quai thao` -> `Vietnamese conical hat / poem conical hat / flat palm hat`
- `guốc mộc` -> `wooden clogs`
- `đồng phục học sinh / áo trắng học sinh` -> `school uniform / white Vietnamese school uniform`
- `khăn quàng đỏ` -> `Young Pioneer red scarf`

### E. Lễ hội, Phong tục & Tín ngưỡng (Festivals, Traditions & Spirituals)
- `Tết / Tết Nguyên Đán / đêm giao thừa` -> `Vietnamese Lunar New Year / Lunar New Year's Eve`
- `Tết Trung Thu / rước đèn / múa lân` -> `Mid-Autumn Festival / lantern procession / lion dance`
- `lì xì / bao lì xì / mừng tuổi` -> `lucky money / red lucky-money envelope / giving lucky money`
- `cúng ông Công ông Táo` -> `Kitchen Gods ceremony`
- `đèn ông sao / đèn kéo quân` -> `star-shaped lantern / rotating paper lantern`
- `cúng gia tiên / bàn thờ gia tiên / thắp hương / bát hương` -> `ancestor worship / ancestral altar / burning incense / incense bowl`
- `đi lễ chùa / xin chữ / xông đất` -> `visiting pagoda for worship / requesting calligraphy / first-footing`
- `múa rối nước / hát quan họ / hát chèo / tuồng / cải lương` -> `Vietnamese water puppetry / Quan Ho singing / cheo opera / classical opera / reformed theater`
- `đờn ca tài tử / ca trù / múa sạp / cồng chiêng` -> `Southern chamber music / ca tru ceremonial singing / bamboo dance / gongs`
- `đàn bầu / đàn tranh / đàn nguyệt / đàn nhị / sáo trúc / trống cơm` -> `monochord / zither / moon lute / two-string fiddle / bamboo flute / cylindrical drum`
- `chùa / đình làng / đền / miếu / lăng tẩm / cổng tam quan` -> `Buddhist pagoda / communal house / temple / shrine / royal mausoleum / three-entrance gate`

### F. Địa danh & Cảnh quan Đặc trưng (Places & Landscapes)
- `Đồng bằng sông Cửu Long / miền Tây` -> `Mekong Delta region`
- `Tây Nguyên / Đồng bằng sông Hồng` -> `Central Highlands / Red River Delta`
- `Hà Nội / Sài Gòn / TP.HCM / Huế / Hội An / Đà Lạt / Đà Nẵng / Sa Pa / Phú Quốc` $\rightarrow `Hanoi / Saigon / Ho Chi Minh City / Hue / Hoi An / Da Lat / Da Nang / Sa Pa / Phu Quoc`
- `ruộng bậc thang / cánh đồng lúa / ruộng lúa` -> `terraced rice fields / rice field / rice paddy`
- `lũy tre / rặng tre / bụi tre` -> `bamboo hedge / bamboo grove`
- `cầu khỉ / cầu tre / bến đò / bến sông` -> `monkey bridge / bamboo bridge / ferry landing / river wharf`
- `rừng ngập mặn / rừng tràm / rừng đước` -> `mangrove forest / melaleuca forest`
- `đồi chè / đồi cát / cánh đồng muối` -> `tea plantation / sand dunes / salt field`
- `phố cổ / phố đi bộ / ngõ nhỏ / hẻm nhỏ` -> `old quarter / pedestrian street / narrow alley`

### G. Giao thông & Hoạt động Đời sống (Transport & Daily Life)
- `xe máy / xe số / xe tay ga` -> `motorbike / underbone motorbike / scooter`
- `xe ôm / xe ôm công nghệ` -> `motorbike taxi / app-based motorbike taxi`
- `xe xích lô / xe ba gác / xe bò / xe trâu` -> `cyclo / three-wheeled cargo motorbike / ox cart / buffalo cart`
- `ghe / xuồng / xuồng ba lá / thuyền thúng / đò ngang` -> `small wooden boat / sampan / three-plank sampan / basket boat / river ferry`
- `người bán hàng rong / gánh hàng rong / xe đẩy hàng rong` -> `street vendor / shoulder-pole street vendor / street-vendor cart`
- `quán cóc / quán vỉa hè / trà đá vỉa hè` -> `small sidewalk stall / sidewalk eatery / sidewalk iced tea`
- `cày ruộng / cấy lúa / gặt lúa / tuốt lúa / phơi lúa / đống rơm` -> `plowing rice field / transplanting rice / harvesting rice / threshing rice / drying rice / straw stack`
- `chài lưới / thả lưới / kéo lưới` -> `casting fishing net / pulling fishing net`
- `gói bánh / giã gạo / dệt vải / dệt chiếu / làm gốm` -> `wrapping traditional cakes / pounding rice / weaving fabric / weaving mats / making pottery`
- `đám cưới / cô dâu / chú rể / đám hỏi / đám tang` -> `wedding / bride / groom / engagement ceremony / funeral`
- `vỉa hè / lề đường / ngã tư / cột điện / biển hiệu / bảng hiệu` -> `sidewalk / roadside / intersection / utility pole / signboard`
