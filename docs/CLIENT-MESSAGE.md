# Message to the client — test account access

Three asks, all small, all on their side. Sending this early matters: the
reconciliation gate cannot run without item 2, and item 3 needs a week of
elapsed time to be useful.

Their test account is **`iron_jor`** (IRON_JO, calisthenics gear, Amman) —
already a professional account, ~1,483 followers, posts from January to July 2026,
quiet since 31 July.

---

## English

> Hi [name],
>
> We're setting up the analytics for `iron_jor` and there are three quick things
> we need from your side.
>
> **1. Confirm the account type.** It looks like `iron_jor` is already a Business
> or Creator account, which is what we need — Instagram only makes analytics
> available on professional accounts. If any other accounts are coming later,
> they'll need to be switched over too. It takes a minute in Settings → Account
> type.
>
> **2. Access to the account's own Instagram Insights.** Before we show you a
> single number, we check every figure our system produces against what Instagram
> itself reports for the same day. To do that we need to see both sides. Either
> temporary login access, or screenshots of the Insights screen for a few
> specific days — whichever you prefer. Screenshots work fine, they're just
> slower if something needs investigating.
>
> **3. Post two or three times over the next week.** The account has been quiet
> since the end of July. A little day-to-day movement makes it much easier for us
> to confirm the numbers are landing on the right dates, which is exactly the
> kind of error that's invisible on a flat account.
>
> Once those are in place we'll connect the account and start the trial.
>
> Thanks,
> [name]

---

## Arabic

> مرحباً [الاسم]،
>
> نحن بصدد إعداد التحليلات لحساب `iron_jor`، ونحتاج منكم ثلاثة أمور بسيطة.
>
> **١. تأكيد نوع الحساب.** يبدو أن `iron_jor` حساب أعمال أو حساب منشئ محتوى، وهو
> المطلوب — إنستغرام لا يوفّر التحليلات إلا للحسابات الاحترافية. وإذا كانت هناك
> حسابات أخرى لاحقاً، فستحتاج إلى التحويل أيضاً. الأمر يستغرق دقيقة من
> الإعدادات ← نوع الحساب.
>
> **٢. الوصول إلى إحصاءات إنستغرام الخاصة بالحساب.** قبل أن نعرض عليكم أي رقم،
> نقوم بمطابقة كل رقم ينتجه نظامنا مع ما يعرضه إنستغرام نفسه لليوم ذاته، ولذلك
> نحتاج إلى رؤية الطرفين. إما وصول مؤقت لتسجيل الدخول، أو صور من شاشة الإحصاءات
> لأيام محددة — كما تفضّلون. الصور كافية، لكنها أبطأ إذا احتجنا إلى التحقق من شيء.
>
> **٣. النشر مرتين أو ثلاث خلال الأسبوع القادم.** الحساب هادئ منذ نهاية تموز، ووجود
> حركة يومية يسهّل علينا كثيراً التأكد من أن الأرقام تُسجَّل في التواريخ الصحيحة،
> وهو بالضبط نوع الخطأ الذي لا يظهر على حساب ساكن.
>
> بعد اكتمال هذه النقاط سنربط الحساب ونبدأ الفترة التجريبية.
>
> شكراً لكم،
> [الاسم]

---

## Why each ask exists

**1 — account type.** A personal account cannot expose insights at all. If it
were personal, the connect flow would fail outright, so this is worth confirming
before anything else rather than discovering it mid-demo.

**2 — Insights access.** This is the project's most important gate. Every test in
the repo runs against a mock built from documentation; comparing against
Instagram's own figures is the only check against reality, and it can fail. Both
sides are needed or there is nothing to compare.

**3 — posting cadence.** A flat account hides date-boundary errors. If followers
and reach barely move, a figure landing one day late looks identical to a correct
one — and that is precisely the defect class that took the most work to fix, and
whose fix has never been validated against a live response.

## Do not ask for

**Their Instagram password, under any circumstance.** The connection uses
Instagram's own OAuth screen; we never see credentials. Password-based access is
what actually gets accounts restricted, and being able to say we never ask for it
is worth more than any convenience it would buy.
