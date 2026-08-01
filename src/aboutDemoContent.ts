import type { AppLocale } from "./i18n/locales";

export type AboutDemoTextKey =
  | "research.root"
  | "research.options"
  | "research.lightweight"
  | "research.price"
  | "research.criteria"
  | "research.battery"
  | "research.findings"
  | "research.nextCheck"
  | "travel.root"
  | "travel.activities"
  | "travel.scenery"
  | "travel.morningView"
  | "travel.tickets"
  | "travel.travelPass"
  | "travel.itinerary"
  | "travel.day1"
  | "travel.day2"
  | "travel.schedule"
  | "app.root"
  | "app.plan"
  | "app.users"
  | "app.needs"
  | "app.design"
  | "app.screen"
  | "app.build"
  | "app.core"
  | "app.release"
  | "app.test";

type DemoLocale = "en" | "ja" | "es" | "pt-BR" | "fr" | "de" | "ko" | "zh-Hans" | "zh-Hant" | "id" | "hi" | "ar";

export type AboutDemoCopy = {
  titles: Record<AboutDemoTextKey, string>;
  nodeBody: string;
  researchBody: string;
  travelBody: string;
  appBody: string;
  nextDecision: string;
  ticketDecision: string;
  reminder: string;
  ticketFileName: string;
  aiTokenLabel: string;
  aiTokenDetail: string;
  chatDemoDetail: string;
};

const keys: AboutDemoTextKey[] = [
  "research.root", "research.options", "research.lightweight", "research.price", "research.criteria", "research.battery", "research.findings", "research.nextCheck",
  "travel.root", "travel.activities", "travel.scenery", "travel.morningView", "travel.tickets", "travel.travelPass", "travel.itinerary", "travel.day1", "travel.day2", "travel.schedule",
  "app.root", "app.plan", "app.users", "app.needs", "app.design", "app.screen", "app.build", "app.core", "app.release", "app.test",
];

function copy(values: string[], details: Omit<AboutDemoCopy, "titles">): AboutDemoCopy {
  if (values.length !== keys.length) throw new Error("About demo title catalog is incomplete.");
  return { ...details, titles: Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<AboutDemoTextKey, string> };
}

const CATALOG: Record<DemoLocale, AboutDemoCopy> = {
  en: copy(
    ["Choose a new computer", "Options", "Lightweight model", "Price", "Comparison criteria", "Battery life", "What I found", "Next check", "Plan a trip", "Things to do", "Scenery", "Morning view", "Tickets", "Travel pass", "Itinerary", "Day 1", "Day 2", "Schedule", "App development notes", "Plan", "Users", "Needs", "Design", "Screen design", "Build", "Core feature", "Release", "Test"],
    { nodeBody: "Add details, decisions, and useful links here.", researchBody: "A fixed sample universe for organizing AI research and your own decisions.", travelBody: "A fixed sample universe for planning a trip.", appBody: "A fixed sample universe for planning an app.", nextDecision: "Continue shaping this branch in Mind Atlas.", ticketDecision: "Confirm the travel pass before departure.", reminder: "Reminder: confirm travel pass", ticketFileName: "travel-pass-qr.svg", aiTokenLabel: "AI token balance", aiTokenDetail: "Google sign-in and the USD 10 Mind Atlas Pro plan unlock AI features.", chatDemoDetail: "Landing page demo" },
  ),
  ja: copy(
    ["新しいパソコンを選ぶ", "候補", "軽量モデル", "価格", "比較条件", "バッテリー", "調べたこと", "次に確認すること", "旅行計画を立てる", "やりたいこと", "見たい景色", "朝の景色", "チケット類", "乗車チケット", "計画", "1日目", "2日目", "スケジュール", "アプリ開発のメモ", "企画", "ユーザー", "ニーズ", "設計", "画面設計", "開発", "コア機能", "リリース", "テスト"],
    { nodeBody: "ここに詳細、判断、役立つリンクを書きます。", researchBody: "AIで調べたことと自分の判断を整理する固定サンプル宇宙です。", travelBody: "旅行を組み立てるための固定サンプル宇宙です。", appBody: "アプリを組み立てるための固定サンプル宇宙です。", nextDecision: "Mind Atlasでこの枝を続けて育てます。", ticketDecision: "出発前に乗車チケットを確認します。", reminder: "リマインダー: 乗車チケットを確認", ticketFileName: "乗車チケット-QR.svg", aiTokenLabel: "AIトークン残高", aiTokenDetail: "Googleアカウント登録と月10ドルのMind Atlas ProプランでAI機能が使えます。", chatDemoDetail: "ランディングページのデモ" },
  ),
  es: copy(
    ["Elegir un ordenador nuevo", "Opciones", "Modelo ligero", "Precio", "Criterios de comparación", "Duración de la batería", "Lo que averigüé", "Siguiente comprobación", "Planificar un viaje", "Cosas por hacer", "Paisajes", "Vista matinal", "Billetes", "Pase de viaje", "Itinerario", "Día 1", "Día 2", "Horario", "Notas de desarrollo de la aplicación", "Plan", "Usuarios", "Necesidades", "Diseño", "Diseño de pantalla", "Desarrollo", "Función principal", "Lanzamiento", "Pruebas"],
    { nodeBody: "Añade aquí detalles, decisiones y enlaces útiles.", researchBody: "Un universo de muestra fijo para organizar la investigación con IA y tus propias decisiones.", travelBody: "Un universo de muestra fijo para planificar un viaje.", appBody: "Un universo de muestra fijo para planificar una aplicación.", nextDecision: "Sigue desarrollando esta rama en Mind Atlas.", ticketDecision: "Confirma el pase de viaje antes de partir.", reminder: "Recordatorio: confirma el pase de viaje", ticketFileName: "pase-de-viaje-qr.svg", aiTokenLabel: "Saldo de tokens de IA", aiTokenDetail: "El inicio de sesión con Google y el plan Mind Atlas Pro de 10 USD desbloquean las funciones de IA.", chatDemoDetail: "Demostración de la página de inicio" },
  ),
  "pt-BR": copy(
    ["Escolher um computador novo", "Opções", "Modelo leve", "Preço", "Critérios de comparação", "Duração da bateria", "O que descobri", "Próxima verificação", "Planejar uma viagem", "Coisas para fazer", "Paisagens", "Vista da manhã", "Passagens", "Passe de viagem", "Itinerário", "Dia 1", "Dia 2", "Programação", "Notas de desenvolvimento do aplicativo", "Plano", "Usuários", "Necessidades", "Design", "Design de telas", "Desenvolvimento", "Recurso principal", "Lançamento", "Teste"],
    { nodeBody: "Adicione detalhes, decisões e links úteis aqui.", researchBody: "Um universo de exemplo fixo para organizar pesquisas com IA e suas próprias decisões.", travelBody: "Um universo de exemplo fixo para planejar uma viagem.", appBody: "Um universo de exemplo fixo para planejar um aplicativo.", nextDecision: "Continue desenvolvendo este ramo no Mind Atlas.", ticketDecision: "Confirme o passe de viagem antes da partida.", reminder: "Lembrete: confirme o passe de viagem", ticketFileName: "passe-de-viagem-qr.svg", aiTokenLabel: "Saldo de tokens de IA", aiTokenDetail: "O login do Google e o plano Mind Atlas Pro de US$ 10 liberam os recursos de IA.", chatDemoDetail: "Demonstração da página inicial" },
  ),
  fr: copy(
    ["Choisir un nouvel ordinateur", "Options", "Modèle léger", "Prix", "Critères de comparaison", "Autonomie", "Ce que j’ai trouvé", "Prochaine vérification", "Planifier un voyage", "À faire", "Paysages", "Vue du matin", "Billets", "Pass de voyage", "Itinéraire", "Jour 1", "Jour 2", "Programme", "Notes de développement d'application", "Plan", "Utilisateurs", "Besoins", "Conception", "Conception des écrans", "Développement", "Fonction principale", "Publication", "Tests"],
    { nodeBody: "Ajoutez ici des détails, des décisions et des liens utiles.", researchBody: "Un univers d'exemple fixe pour organiser les recherches avec l’IA et vos propres décisions.", travelBody: "Un univers d'exemple fixe pour préparer un voyage.", appBody: "Un univers d'exemple fixe pour préparer une application.", nextDecision: "Continuez à développer cette branche dans Mind Atlas.", ticketDecision: "Confirmez le pass de voyage avant le départ.", reminder: "Rappel : confirmer le pass de voyage", ticketFileName: "pass-de-voyage-qr.svg", aiTokenLabel: "Solde de jetons IA", aiTokenDetail: "La connexion Google et le plan Mind Atlas Pro à 10 USD déverrouillent les fonctions IA.", chatDemoDetail: "Démo de la page de présentation" },
  ),
  de: copy(
    ["Einen neuen Computer auswählen", "Optionen", "Leichtes Modell", "Preis", "Vergleichskriterien", "Akkulaufzeit", "Was ich herausgefunden habe", "Als Nächstes prüfen", "Eine Reise planen", "Unternehmungen", "Landschaft", "Morgenansicht", "Tickets", "Reisepass", "Reiseplan", "Tag 1", "Tag 2", "Zeitplan", "Notizen zur App-Entwicklung", "Plan", "Nutzer", "Bedürfnisse", "Entwurf", "Bildschirmdesign", "Entwicklung", "Kernfunktion", "Veröffentlichung", "Test"],
    { nodeBody: "Fügen Sie hier Details, Entscheidungen und nützliche Links hinzu.", researchBody: "Ein festes Beispieluniversum zum Ordnen von KI-Recherchen und eigenen Entscheidungen.", travelBody: "Ein festes Beispieluniversum zum Planen einer Reise.", appBody: "Ein festes Beispieluniversum zum Planen einer App.", nextDecision: "Entwickeln Sie diesen Zweig in Mind Atlas weiter.", ticketDecision: "Bestätigen Sie den Reisepass vor der Abfahrt.", reminder: "Erinnerung: Reisepass bestätigen", ticketFileName: "reise-pass-qr.svg", aiTokenLabel: "KI-Token-Guthaben", aiTokenDetail: "Google-Anmeldung und der Mind Atlas Pro-Plan für 10 USD schalten KI-Funktionen frei.", chatDemoDetail: "Landingpage-Demo" },
  ),
  ko: copy(
    ["새 컴퓨터 고르기", "후보", "경량 모델", "가격", "비교 기준", "배터리 사용 시간", "알아본 내용", "다음 확인 사항", "여행 계획 세우기", "하고 싶은 일", "보고 싶은 풍경", "아침 풍경", "티켓", "여행 패스", "일정", "1일차", "2일차", "스케줄", "앱 개발 메모", "기획", "사용자", "요구 사항", "설계", "화면 설계", "개발", "핵심 기능", "출시", "테스트"],
    { nodeBody: "여기에 세부 사항, 결정, 유용한 링크를 추가합니다.", researchBody: "AI로 조사한 내용과 자신의 판단을 정리하는 고정 샘플 우주입니다.", travelBody: "여행을 계획하기 위한 고정 샘플 우주입니다.", appBody: "앱을 계획하기 위한 고정 샘플 우주입니다.", nextDecision: "Mind Atlas에서 이 가지를 계속 발전시킵니다.", ticketDecision: "출발 전에 여행 패스를 확인합니다.", reminder: "알림: 여행 패스 확인", ticketFileName: "여행-패스-qr.svg", aiTokenLabel: "AI 토큰 잔액", aiTokenDetail: "Google 로그인과 월 10달러 Mind Atlas Pro 플랜으로 AI 기능을 사용할 수 있습니다.", chatDemoDetail: "랜딩 페이지 데모" },
  ),
  "zh-Hans": copy(
    ["选择一台新电脑", "候选项", "轻薄型号", "价格", "比较条件", "续航时间", "查到的内容", "下一步确认", "制定旅行计划", "想做的事", "想看的风景", "清晨景色", "票券", "旅行通票", "行程", "第1天", "第2天", "日程", "应用开发笔记", "规划", "用户", "需求", "设计", "界面设计", "开发", "核心功能", "发布", "测试"],
    { nodeBody: "在这里添加细节、决策和有用链接。", researchBody: "用于整理 AI 调研内容和自己判断的固定示例宇宙。", travelBody: "用于规划旅行的固定示例宇宙。", appBody: "用于规划应用的固定示例宇宙。", nextDecision: "在 Mind Atlas 中继续完善这个分支。", ticketDecision: "出发前确认旅行通票。", reminder: "提醒：确认旅行通票", ticketFileName: "旅行通票-qr.svg", aiTokenLabel: "AI 令牌余额", aiTokenDetail: "Google 登录和每月 10 美元的 Mind Atlas Pro 方案可解锁 AI 功能。", chatDemoDetail: "落地页演示" },
  ),
  "zh-Hant": copy(
    ["選擇一台新電腦", "候選項", "輕薄機型", "價格", "比較條件", "電池續航力", "查到的內容", "下一步確認", "規劃旅行", "想做的事", "想看的風景", "清晨景色", "票券", "旅行通行證", "行程", "第 1 天", "第 2 天", "日程", "應用程式開發筆記", "規劃", "使用者", "需求", "設計", "畫面設計", "開發", "核心功能", "發布", "測試"],
    { nodeBody: "在此加入細節、決策和實用連結。", researchBody: "用於整理 AI 研究內容和自己判斷的固定範例宇宙。", travelBody: "用於規劃旅行的固定範例宇宙。", appBody: "用於規劃應用程式的固定範例宇宙。", nextDecision: "在 Mind Atlas 中繼續發展這個分支。", ticketDecision: "出發前確認旅行通行證。", reminder: "提醒：確認旅行通行證", ticketFileName: "旅行通行證-qr.svg", aiTokenLabel: "AI 權杖餘額", aiTokenDetail: "Google 登入和每月 10 美元的 Mind Atlas Pro 方案可解鎖 AI 功能。", chatDemoDetail: "登陸頁示範" },
  ),
  id: copy(
    ["Memilih komputer baru", "Pilihan", "Model ringan", "Harga", "Kriteria perbandingan", "Daya tahan baterai", "Hasil pencarian", "Pemeriksaan berikutnya", "Merencanakan perjalanan", "Hal yang ingin dilakukan", "Pemandangan", "Pemandangan pagi", "Tiket", "Pas perjalanan", "Rencana perjalanan", "Hari 1", "Hari 2", "Jadwal", "Catatan pengembangan aplikasi", "Rencana", "Pengguna", "Kebutuhan", "Desain", "Desain layar", "Pengembangan", "Fitur inti", "Rilis", "Pengujian"],
    { nodeBody: "Tambahkan detail, keputusan, dan tautan berguna di sini.", researchBody: "Contoh semesta tetap untuk mengatur riset AI dan keputusan Anda sendiri.", travelBody: "Contoh semesta tetap untuk merencanakan perjalanan.", appBody: "Contoh semesta tetap untuk merencanakan aplikasi.", nextDecision: "Lanjutkan mengembangkan cabang ini di Mind Atlas.", ticketDecision: "Konfirmasikan pas perjalanan sebelum berangkat.", reminder: "Pengingat: konfirmasikan pas perjalanan", ticketFileName: "pas-perjalanan-qr.svg", aiTokenLabel: "Saldo token AI", aiTokenDetail: "Login Google dan paket Mind Atlas Pro USD 10 membuka fitur AI.", chatDemoDetail: "Demo halaman landing" },
  ),
  hi: copy(
    ["नया कंप्यूटर चुनें", "विकल्प", "हल्का मॉडल", "कीमत", "तुलना के मानदंड", "बैटरी अवधि", "जो जानकारी मिली", "अगली जांच", "यात्रा की योजना बनाएं", "करने योग्य चीज़ें", "दृश्य", "सुबह का दृश्य", "टिकट", "यात्रा पास", "यात्रा कार्यक्रम", "दिन 1", "दिन 2", "समय-सारिणी", "ऐप विकास नोट्स", "योजना", "उपयोगकर्ता", "ज़रूरतें", "डिज़ाइन", "स्क्रीन डिज़ाइन", "विकास", "मुख्य सुविधा", "रिलीज़", "परीक्षण"],
    { nodeBody: "यहां विवरण, निर्णय और उपयोगी लिंक जोड़ें।", researchBody: "AI से मिली जानकारी और अपने निर्णयों को व्यवस्थित करने के लिए एक स्थिर नमूना ब्रह्मांड।", travelBody: "यात्रा की योजना बनाने के लिए एक स्थिर नमूना ब्रह्मांड।", appBody: "ऐप की योजना बनाने के लिए एक स्थिर नमूना ब्रह्मांड।", nextDecision: "Mind Atlas में इस शाखा को विकसित करते रहें।", ticketDecision: "प्रस्थान से पहले यात्रा पास की पुष्टि करें।", reminder: "रिमाइंडर: यात्रा पास की पुष्टि करें", ticketFileName: "यात्रा-पास-qr.svg", aiTokenLabel: "AI टोकन शेष", aiTokenDetail: "Google साइन-इन और USD 10 Mind Atlas Pro योजना AI सुविधाएं खोलती है।", chatDemoDetail: "लैंडिंग पेज डेमो" },
  ),
  ar: copy(
    ["اختر حاسوبًا جديدًا", "الخيارات", "طراز خفيف", "السعر", "معايير المقارنة", "عمر البطارية", "ما توصلت إليه", "التحقق التالي", "خطط لرحلة", "أشياء تريد القيام بها", "مناظر", "منظر الصباح", "التذاكر", "بطاقة السفر", "خط الرحلة", "اليوم الأول", "اليوم الثاني", "الجدول", "ملاحظات تطوير التطبيق", "الخطة", "المستخدمون", "الاحتياجات", "التصميم", "تصميم الشاشة", "التطوير", "الميزة الأساسية", "الإطلاق", "الاختبار"],
    { nodeBody: "أضف التفاصيل والقرارات والروابط المفيدة هنا.", researchBody: "كون نموذجي ثابت لتنظيم بحث الذكاء الاصطناعي وقراراتك الخاصة.", travelBody: "كون نموذجي ثابت لتخطيط رحلة.", appBody: "كون نموذجي ثابت لتخطيط تطبيق.", nextDecision: "تابع تطوير هذا الفرع في Mind Atlas.", ticketDecision: "أكد بطاقة السفر قبل المغادرة.", reminder: "تذكير: أكد بطاقة السفر", ticketFileName: "بطاقة-السفر-qr.svg", aiTokenLabel: "رصيد رموز الذكاء الاصطناعي", aiTokenDetail: "تسجيل الدخول عبر Google وخطة Mind Atlas Pro بسعر 10 دولارات يفتحان ميزات الذكاء الاصطناعي.", chatDemoDetail: "عرض الصفحة التعريفية" },
  ),
};

export function aboutDemoCopy(locale: AppLocale): AboutDemoCopy {
  if (locale === "en-XA") return CATALOG.en;
  if (locale === "ar-XB") return CATALOG.ar;
  return CATALOG[locale as DemoLocale] ?? CATALOG.en;
}
