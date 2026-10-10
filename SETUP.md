# Orbit setup

About 30 minutes. You need four free accounts: GitHub, Supabase, Vercel and Google AI Studio.

What each one does:
- **Supabase** handles sign-up, log-in and stores everyone's sets privately.
- **Vercel** hosts the site and runs the small server that talks to the AI.
- **Google AI Studio** gives you the key for the AI (Gemini).
- **GitHub** holds the code so Vercel can publish it.

## 1. Supabase

1. Go to supabase.com, create a project. Pick a region close to you (Europe is closest to Ghana). Save the database password somewhere.
2. Open **SQL Editor**, choose **New query**, paste everything from `supabase/schema.sql`, press **Run**. You should see "Success".
3. Open **Authentication > Sign In / Providers** and check that **Email** is on.
4. Still in Authentication, find the **Confirm email** switch and turn it **off** for now.
   Supabase's built-in email service only sends 2 emails an hour, so confirmation and password-reset emails will fail once a few people sign up. Before you invite many friends, add your own email sender under **Authentication > SMTP Settings** (Resend and Brevo both have free plans), then turn Confirm email back on.
5. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key (newer dashboards may call it the publishable key). You need both in step 4.

## 2. Gemini key

1. Go to aistudio.google.com/apikey and press **Create API key**. Copy it.
2. In AI Studio, check which Flash model your free plan allows. If it is not `gemini-2.5-flash`, you will set `GEMINI_MODEL` in step 4.

## 3. GitHub

1. Create a new repository called `orbit`. Private is fine.
2. Press **Add file > Upload files** and drag in everything from the Orbit folder: the `public`, `api` and `supabase` folders, plus `package.json`, `vercel.json`, `SETUP.md` and `.env.example`. Keep the folders as they are. Make the repository private, because `api/_owner.js` holds your personal teaching style.
3. Press **Commit changes**.

## 4. Vercel

1. Go to vercel.com, sign in with GitHub, press **Add New > Project** and import `orbit`.
2. Leave Framework as **Other**. Leave the build settings empty.
3. Open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | the Project URL from step 1 |
   | `SUPABASE_ANON_KEY` | the anon public key from step 1 |
   | `GEMINI_API_KEY` | the key from step 2 |
   | `OWNER_EMAIL` | the email you will sign up with. Only this account gets your personal teaching style |
   | `GEMINI_MODEL` | optional, only if the default does not work for you |
   | `AI_DAILY_LIMIT` | optional, AI requests per person per day. Default 120 |

4. Press **Deploy**. When it finishes you get an address like `orbit-yourname.vercel.app`.

## 5. Tell Supabase the address

Back in Supabase, open **Authentication > URL Configuration**. Set **Site URL** to your Vercel address. Under **Redirect URLs**, add the same address followed by `/**`. This makes password-reset and confirmation links return to Orbit.

## 6. Try it

1. Open your Vercel address and create your account first, using the email you set as `OWNER_EMAIL`. Do this before you share the link with anyone.
2. Make a set from some notes. Ask the tutor a question.
3. Log out, then log in from a different device. Your sets should be there.

## Changing how the AI talks to you

Press **Edit profile** on the home screen. The box called "How should Orbit teach you?" is what the tutor, quizzes and audio lessons follow. When you first sign up with `OWNER_EMAIL`, it starts with your personal style from `api/_owner.js`. Anyone else starts from a short neutral default and can rewrite it for themselves. Your personal text is never in the public site, only sent to your logged-in account.

The fixed rules (use your notes, never invent facts, plain English) are in `api/_persona.js`.

## Limits to know about

- Playing audio lessons, flashcards, quizzes, the matching game and spaced repetition cost nothing to run. Only the AI calls use quota.
- Google's free Gemini plan has its own per-minute and per-day caps. If many people use Orbit at once, they will see "The AI service is busy". As far as I know, Google's free tier terms allow it to use prompts to improve its products, so read the current terms before putting anything sensitive in.
- Lecture recording uses the browser's speech service. It works in Chrome and Edge, not in Safari or Firefox.

## If something goes wrong

| What you see | Fix |
| --- | --- |
| "This site is missing its Supabase settings" | The two Supabase variables are not set. Add them in Vercel, then **Deployments > Redeploy**. |
| "AI is not set up on this site yet" | `GEMINI_API_KEY` is missing or wrong. Fix it and redeploy. |
| "The AI service is busy" | Google's free limit was hit. Wait a minute. |
| Sign-up works but no email arrives | You hit the 2 emails an hour limit. Turn Confirm email off, or add your own SMTP sender. |
| Sets do not save | Run `supabase/schema.sql` again, then reload. |
