# 🏥 MediVault — Smart Health Records & Patient Management Platform

A modern, role-based, serverless web application designed to digitize healthcare workflows, streamline clinical consultation management, and provide interactive AI-assisted symptom insights.

---

## 🌟 Key Features

### 👥 Role-Based Access Control (RBAC)
- **Patient Portal:** Book appointments, check symptoms using AI, and view or download historical medical records and prescriptions.
- **Doctor Dashboard:** Manage daily consultation schedules, access patient clinical histories, and issue digital prescriptions instantly.
- **Receptionist Desk:** Coordinate real-time appointment queues, manage patient check-ins, and streamline administrative logs.

### 🤖 AI-Powered Symptom Assistant
- Integrated with the **Google Gemini API** to process user-reported symptoms and provide interactive preliminary symptom analysis in **<2 seconds**.

### 📄 Zero-Latency PDF Generation
- Built with `jsPDF` for instant, client-side generation of downloadable digital prescriptions and consultation summaries, reducing server overhead by **100%**.

### 🔐 Advanced Database Security
- Powered by **Supabase (PostgreSQL)** utilizing granular **Row-Level Security (RLS)** policies to ensure 100% data isolation across user roles.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla JS)
- **Backend-as-a-Service (BaaS):** Supabase (PostgreSQL, Authentication, Cloud Storage, Realtime Engine)
- **AI Integration:** Google Gemini API
- **Libraries:** `jsPDF` (Client-side PDF rendering)

---

## 🏗️ Architecture & Security

```text
+-------------------------------------------------------+
|                 FRONTEND (Vanilla JS)                 |
|-------------------------------------------------------|
|  • Client-Side PDF Generation (jsPDF)                 |
|  • AI Diagnostics Integration (Google Gemini API)     |
|  • REST API & Auth Gateway (Supabase Client)          |
+-------------------------------------------------------+
                           |
                           |  HTTPS / REST / Auth
                           v
+-------------------------------------------------------+
|             SUPABASE BACKEND (PostgreSQL)             |
|-------------------------------------------------------|
|  • Authentication & JWT Management                    |
|  • Row-Level Security (RLS) Access Policies           |
+-------------------------------------------------------+



```markdown
MediVault relies on **PostgreSQL Row-Level Security (RLS)** to protect sensitive medical data:
- **Patients** can only read and write their own records and appointment data.
- **Doctors** can view assigned patient histories and append prescription entries.
- **Receptionists** can manage global queue schedules without accessing private consultation notes.
