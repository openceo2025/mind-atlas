import type { AppLocale } from "./i18n/locales";

export type AboutDemoTextKey =
  | "novel.root"
  | "novel.characters"
  | "novel.protagonist"
  | "novel.goal"
  | "novel.chapter1"
  | "novel.opening"
  | "novel.chapter2"
  | "novel.turning"
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
  novelBody: string;
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
  "novel.root", "novel.characters", "novel.protagonist", "novel.goal", "novel.chapter1", "novel.opening", "novel.chapter2", "novel.turning",
  "travel.root", "travel.activities", "travel.scenery", "travel.morningView", "travel.tickets", "travel.travelPass", "travel.itinerary", "travel.day1", "travel.day2", "travel.schedule",
  "app.root", "app.plan", "app.users", "app.needs", "app.design", "app.screen", "app.build", "app.core", "app.release", "app.test",
];

function copy(values: string[], details: Omit<AboutDemoCopy, "titles">): AboutDemoCopy {
  if (values.length !== keys.length) throw new Error("About demo title catalog is incomplete.");
  return { ...details, titles: Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<AboutDemoTextKey, string> };
}

const CATALOG: Record<DemoLocale, AboutDemoCopy> = {
  en: copy(
    ["Write a novel", "Characters", "Protagonist", "Goal", "Chapter 1", "Opening scene", "Chapter 2", "Turning point", "Plan a trip", "Things to do", "Scenery", "Morning view", "Tickets", "Travel pass", "Itinerary", "Day 1", "Day 2", "Schedule", "App development notes", "Plan", "Users", "Needs", "Design", "Screen design", "Build", "Core feature", "Release", "Test"],
    { nodeBody: "Add details, decisions, and useful links here.", novelBody: "A fixed sample universe for planning a story.", travelBody: "A fixed sample universe for planning a trip.", appBody: "A fixed sample universe for planning an app.", nextDecision: "Continue shaping this branch in Mind Atlas.", ticketDecision: "Confirm the travel pass before departure.", reminder: "Reminder: confirm travel pass", ticketFileName: "travel-pass-qr.svg", aiTokenLabel: "AI token balance", aiTokenDetail: "Google sign-in and the USD 10 Mind Atlas Pro plan unlock AI features.", chatDemoDetail: "Landing page demo" },
  ),
  ja: copy(
    ["小説を書く", "登場人物", "主人公", "目的", "第1章", "冒頭の場面", "第2章", "転機", "旅行計画を立てる", "やりたいこと", "見たい景色", "朝の景色", "チケット類", "乗車チケット", "計画", "1日目", "2日目", "スケジュール", "アプリ開発のメモ", "企画", "ユーザー", "ニーズ", "設計", "画面設計", "開発", "コア機能", "リリース", "テスト"],
    { nodeBody: "ここに詳細、判断、役立つリンクを書きます。", novelBody: "物語を組み立てるための固定サンプル宇宙です。", travelBody: "旅行を組み立てるための固定サンプル宇宙です。", appBody: "アプリを組み立てるための固定サンプル宇宙です。", nextDecision: "Mind Atlasでこの枝を続けて育てます。", ticketDecision: "出発前に乗車チケットを確認します。", reminder: "リマインダー: 乗車チケットを確認", ticketFileName: "乗車チケット-QR.svg", aiTokenLabel: "AIトークン残高", aiTokenDetail: "Googleアカウント登録と月10ドルのMind Atlas ProプランでAI機能が使えます。", chatDemoDetail: "ランディングページのデモ" },
  ),
  es: copy(
    ["Escribir una novela", "Personajes", "Protagonista", "Objetivo", "Capítulo 1", "Escena inicial", "Capítulo 2", "Punto de giro", "Planificar un viaje", "Cosas por hacer", "Paisajes", "Vista matinal", "Billetes", "Pase de viaje", "Itinerario", "Día 1", "Día 2", "Horario", "Notas de desarrollo de la aplicación", "Plan", "Usuarios", "Necesidades", "Diseño", "Diseño de pantalla", "Desarrollo", "Función principal", "Lanzamiento", "Pruebas"],
    { nodeBody: "Añade aquí detalles, decisiones y enlaces útiles.", novelBody: "Un universo de muestra fijo para planificar una historia.", travelBody: "Un universo de muestra fijo para planificar un viaje.", appBody: "Un universo de muestra fijo para planificar una aplicación.", nextDecision: "Sigue desarrollando esta rama en Mind Atlas.", ticketDecision: "Confirma el pase de viaje antes de partir.", reminder: "Recordatorio: confirma el pase de viaje", ticketFileName: "pase-de-viaje-qr.svg", aiTokenLabel: "Saldo de tokens de IA", aiTokenDetail: "El inicio de sesión con Google y el plan Mind Atlas Pro de 10 USD desbloquean las funciones de IA.", chatDemoDetail: "Demostración de la página de inicio" },
  ),
  "pt-BR": copy(
    ["Escrever um romance", "Personagens", "Protagonista", "Objetivo", "Capítulo 1", "Cena de abertura", "Capítulo 2", "Ponto de virada", "Planejar uma viagem", "Coisas para fazer", "Paisagens", "Vista da manhã", "Passagens", "Passe de viagem", "Itinerário", "Dia 1", "Dia 2", "Programação", "Notas de desenvolvimento do aplicativo", "Plano", "Usuários", "Necessidades", "Design", "Design de telas", "Desenvolvimento", "Recurso principal", "Lançamento", "Teste"],
    { nodeBody: "Adicione detalhes, decisões e links úteis aqui.", novelBody: "Um universo de exemplo fixo para planejar uma história.", travelBody: "Um universo de exemplo fixo para planejar uma viagem.", appBody: "Um universo de exemplo fixo para planejar um aplicativo.", nextDecision: "Continue desenvolvendo este ramo no Mind Atlas.", ticketDecision: "Confirme o passe de viagem antes da partida.", reminder: "Lembrete: confirme o passe de viagem", ticketFileName: "passe-de-viagem-qr.svg", aiTokenLabel: "Saldo de tokens de IA", aiTokenDetail: "O login do Google e o plano Mind Atlas Pro de US$ 10 liberam os recursos de IA.", chatDemoDetail: "Demonstração da página inicial" },
  ),
  fr: copy(
    ["Écrire un roman", "Personnages", "Protagoniste", "Objectif", "Chapitre 1", "Scène d'ouverture", "Chapitre 2", "Tournant", "Planifier un voyage", "À faire", "Paysages", "Vue du matin", "Billets", "Pass de voyage", "Itinéraire", "Jour 1", "Jour 2", "Programme", "Notes de développement d'application", "Plan", "Utilisateurs", "Besoins", "Conception", "Conception des écrans", "Développement", "Fonction principale", "Publication", "Tests"],
    { nodeBody: "Ajoutez ici des détails, des décisions et des liens utiles.", novelBody: "Un univers d'exemple fixe pour préparer une histoire.", travelBody: "Un univers d'exemple fixe pour préparer un voyage.", appBody: "Un univers d'exemple fixe pour préparer une application.", nextDecision: "Continuez à développer cette branche dans Mind Atlas.", ticketDecision: "Confirmez le pass de voyage avant le départ.", reminder: "Rappel : confirmer le pass de voyage", ticketFileName: "pass-de-voyage-qr.svg", aiTokenLabel: "Solde de jetons IA", aiTokenDetail: "La connexion Google et le plan Mind Atlas Pro à 10 USD déverrouillent les fonctions IA.", chatDemoDetail: "Démo de la page de présentation" },
  ),
  de: copy(
    ["Einen Roman schreiben", "Figuren", "Hauptfigur", "Ziel", "Kapitel 1", "Eröffnungsszene", "Kapitel 2", "Wendepunkt", "Eine Reise planen", "Unternehmungen", "Landschaft", "Morgenansicht", "Tickets", "Reisepass", "Reiseplan", "Tag 1", "Tag 2", "Zeitplan", "Notizen zur App-Entwicklung", "Plan", "Nutzer", "Bedürfnisse", "Entwurf", "Bildschirmdesign", "Entwicklung", "Kernfunktion", "Veröffentlichung", "Test"],
    { nodeBody: "Fügen Sie hier Details, Entscheidungen und nützliche Links hinzu.", novelBody: "Ein festes Beispieluniversum zum Planen einer Geschichte.", travelBody: "Ein festes Beispieluniversum zum Planen einer Reise.", appBody: "Ein festes Beispieluniversum zum Planen einer App.", nextDecision: "Entwickeln Sie diesen Zweig in Mind Atlas weiter.", ticketDecision: "Bestätigen Sie den Reisepass vor der Abfahrt.", reminder: "Erinnerung: Reisepass bestätigen", ticketFileName: "reise-pass-qr.svg", aiTokenLabel: "KI-Token-Guthaben", aiTokenDetail: "Google-Anmeldung und der Mind Atlas Pro-Plan für 10 USD schalten KI-Funktionen frei.", chatDemoDetail: "Landingpage-Demo" },
  ),
  ko: copy(
    ["소설 쓰기", "등장인물", "주인공", "목표", "1장", "도입 장면", "2장", "전환점", "여행 계획 세우기", "하고 싶은 일", "보고 싶은 풍경", "아침 풍경", "티켓", "여행 패스", "일정", "1일차", "2일차", "스케줄", "앱 개발 메모", "기획", "사용자", "요구 사항", "설계", "화면 설계", "개발", "핵심 기능", "출시", "테스트"],
    { nodeBody: "여기에 세부 사항, 결정, 유용한 링크를 추가합니다.", novelBody: "이야기를 계획하기 위한 고정 샘플 우주입니다.", travelBody: "여행을 계획하기 위한 고정 샘플 우주입니다.", appBody: "앱을 계획하기 위한 고정 샘플 우주입니다.", nextDecision: "Mind Atlas에서 이 가지를 계속 발전시킵니다.", ticketDecision: "출발 전에 여행 패스를 확인합니다.", reminder: "알림: 여행 패스 확인", ticketFileName: "여행-패스-qr.svg", aiTokenLabel: "AI 토큰 잔액", aiTokenDetail: "Google 로그인과 월 10달러 Mind Atlas Pro 플랜으로 AI 기능을 사용할 수 있습니다.", chatDemoDetail: "랜딩 페이지 데모" },
  ),
  "zh-Hans": copy(
    ["写小说", "人物", "主角", "目标", "第一章", "开场场景", "第二章", "转折点", "制定旅行计划", "想做的事", "想看的风景", "清晨景色", "票券", "旅行通票", "行程", "第1天", "第2天", "日程", "应用开发笔记", "规划", "用户", "需求", "设计", "界面设计", "开发", "核心功能", "发布", "测试"],
    { nodeBody: "在这里添加细节、决策和有用链接。", novelBody: "用于规划故事的固定示例宇宙。", travelBody: "用于规划旅行的固定示例宇宙。", appBody: "用于规划应用的固定示例宇宙。", nextDecision: "在 Mind Atlas 中继续完善这个分支。", ticketDecision: "出发前确认旅行通票。", reminder: "提醒：确认旅行通票", ticketFileName: "旅行通票-qr.svg", aiTokenLabel: "AI 令牌余额", aiTokenDetail: "Google 登录和每月 10 美元的 Mind Atlas Pro 方案可解锁 AI 功能。", chatDemoDetail: "落地页演示" },
  ),
  "zh-Hant": copy(
    ["寫小說", "人物", "主角", "目標", "第一章", "開場場景", "第二章", "轉折點", "規劃旅行", "想做的事", "想看的風景", "清晨景色", "票券", "旅行通行證", "行程", "第 1 天", "第 2 天", "日程", "應用程式開發筆記", "規劃", "使用者", "需求", "設計", "畫面設計", "開發", "核心功能", "發布", "測試"],
    { nodeBody: "在此加入細節、決策和實用連結。", novelBody: "用於規劃故事的固定範例宇宙。", travelBody: "用於規劃旅行的固定範例宇宙。", appBody: "用於規劃應用程式的固定範例宇宙。", nextDecision: "在 Mind Atlas 中繼續發展這個分支。", ticketDecision: "出發前確認旅行通行證。", reminder: "提醒：確認旅行通行證", ticketFileName: "旅行通行證-qr.svg", aiTokenLabel: "AI 權杖餘額", aiTokenDetail: "Google 登入和每月 10 美元的 Mind Atlas Pro 方案可解鎖 AI 功能。", chatDemoDetail: "登陸頁示範" },
  ),
  id: copy(
    ["Menulis novel", "Tokoh", "Tokoh utama", "Tujuan", "Bab 1", "Adegan pembuka", "Bab 2", "Titik balik", "Merencanakan perjalanan", "Hal yang ingin dilakukan", "Pemandangan", "Pemandangan pagi", "Tiket", "Pas perjalanan", "Rencana perjalanan", "Hari 1", "Hari 2", "Jadwal", "Catatan pengembangan aplikasi", "Rencana", "Pengguna", "Kebutuhan", "Desain", "Desain layar", "Pengembangan", "Fitur inti", "Rilis", "Pengujian"],
    { nodeBody: "Tambahkan detail, keputusan, dan tautan berguna di sini.", novelBody: "Contoh semesta tetap untuk merencanakan cerita.", travelBody: "Contoh semesta tetap untuk merencanakan perjalanan.", appBody: "Contoh semesta tetap untuk merencanakan aplikasi.", nextDecision: "Lanjutkan mengembangkan cabang ini di Mind Atlas.", ticketDecision: "Konfirmasikan pas perjalanan sebelum berangkat.", reminder: "Pengingat: konfirmasikan pas perjalanan", ticketFileName: "pas-perjalanan-qr.svg", aiTokenLabel: "Saldo token AI", aiTokenDetail: "Login Google dan paket Mind Atlas Pro USD 10 membuka fitur AI.", chatDemoDetail: "Demo halaman landing" },
  ),
  hi: copy(
    ["उपन्यास लिखें", "पात्र", "मुख्य पात्र", "लक्ष्य", "अध्याय 1", "आरंभिक दृश्य", "अध्याय 2", "निर्णायक मोड़", "यात्रा की योजना बनाएं", "करने योग्य चीज़ें", "दृश्य", "सुबह का दृश्य", "टिकट", "यात्रा पास", "यात्रा कार्यक्रम", "दिन 1", "दिन 2", "समय-सारिणी", "ऐप विकास नोट्स", "योजना", "उपयोगकर्ता", "ज़रूरतें", "डिज़ाइन", "स्क्रीन डिज़ाइन", "विकास", "मुख्य सुविधा", "रिलीज़", "परीक्षण"],
    { nodeBody: "यहां विवरण, निर्णय और उपयोगी लिंक जोड़ें।", novelBody: "कहानी की योजना बनाने के लिए एक स्थिर नमूना ब्रह्मांड।", travelBody: "यात्रा की योजना बनाने के लिए एक स्थिर नमूना ब्रह्मांड।", appBody: "ऐप की योजना बनाने के लिए एक स्थिर नमूना ब्रह्मांड।", nextDecision: "Mind Atlas में इस शाखा को विकसित करते रहें।", ticketDecision: "प्रस्थान से पहले यात्रा पास की पुष्टि करें।", reminder: "रिमाइंडर: यात्रा पास की पुष्टि करें", ticketFileName: "यात्रा-पास-qr.svg", aiTokenLabel: "AI टोकन शेष", aiTokenDetail: "Google साइन-इन और USD 10 Mind Atlas Pro योजना AI सुविधाएं खोलती है।", chatDemoDetail: "लैंडिंग पेज डेमो" },
  ),
  ar: copy(
    ["اكتب رواية", "الشخصيات", "البطل", "الهدف", "الفصل الأول", "المشهد الافتتاحي", "الفصل الثاني", "نقطة التحول", "خطط لرحلة", "أشياء تريد القيام بها", "مناظر", "منظر الصباح", "التذاكر", "بطاقة السفر", "خط الرحلة", "اليوم الأول", "اليوم الثاني", "الجدول", "ملاحظات تطوير التطبيق", "الخطة", "المستخدمون", "الاحتياجات", "التصميم", "تصميم الشاشة", "التطوير", "الميزة الأساسية", "الإطلاق", "الاختبار"],
    { nodeBody: "أضف التفاصيل والقرارات والروابط المفيدة هنا.", novelBody: "كون نموذجي ثابت لتخطيط قصة.", travelBody: "كون نموذجي ثابت لتخطيط رحلة.", appBody: "كون نموذجي ثابت لتخطيط تطبيق.", nextDecision: "تابع تطوير هذا الفرع في Mind Atlas.", ticketDecision: "أكد بطاقة السفر قبل المغادرة.", reminder: "تذكير: أكد بطاقة السفر", ticketFileName: "بطاقة-السفر-qr.svg", aiTokenLabel: "رصيد رموز الذكاء الاصطناعي", aiTokenDetail: "تسجيل الدخول عبر Google وخطة Mind Atlas Pro بسعر 10 دولارات يفتحان ميزات الذكاء الاصطناعي.", chatDemoDetail: "عرض الصفحة التعريفية" },
  ),
};

export function aboutDemoCopy(locale: AppLocale): AboutDemoCopy {
  if (locale === "en-XA") return CATALOG.en;
  if (locale === "ar-XB") return CATALOG.ar;
  return CATALOG[locale as DemoLocale] ?? CATALOG.en;
}
