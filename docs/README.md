# ClickMenu Project Documentation

> Discover restaurant menus with ClickMenu — a modern, multi-language, WhatsApp-integrated ordering platform designed for Mediterranean cafés in Morocco.

## What Is ClickMenu?

ClickMenu is a restaurant menu discovery and ordering system that bridges the gap between customers and establishments through a sleek, mobile-optimized web interface. Instead of traditional paper menus or manual order taking, customers can browse restaurant menus in English, French, or Arabic, add items to a digital cart, and submit orders directly to the restaurant via WhatsApp.

Unlike generic food delivery platforms like UberEats or Deliveroo, ClickMenu is purpose-built for small to medium-sized restaurants, especially cafés in Morocco, offering a no-frills, user-friendly experience that connects diners without complex subscriptions or commissions.

## Business Value

For Restaurants

Restaurant owners benefit from ClickMenu through operational efficiency and increased order accuracy. The system eliminates manual order transcription, reduces errors, and allows owners to focus on food preparation rather than order taking. The admin dashboard provides real-time visibility into incoming orders, enabling better kitchen coordination. Multi-language support ensures accessibility to diverse customer bases, while the comparison-based revision system prevents data loss during simultaneous edits. The WhatsApp integration is particularly powerful: owners receive orders directly in their messenger app, where they can confirm, prepare, and update the order status without switching between platforms.

For Customers

Customers experience a streamlined, stress-free dining experience. The mobile-first design works perfectly on smartphones, making the menu easy to navigate with swipeable category tabs, instant search, and visual dish previews. Language switching is instantaneous—no page reloads required—so patrons can browse in their native tongue. The cart interface is intuitive, with quantity controls, subtotal calculations, and clear order details. When submitting an order, customers see a preview of the message they're about to send, ensuring accuracy before WhatsApp opens. The order confirmation flow provides instant feedback, and the ability to reorder previously placed orders improves convenience.

## Core Philosophy

Mobile-First by Design

Every pixel is optimized for mobile devices. Large touch targets, generous spacing, and thumb-friendly controls reflect the fact that most customers access menus via phone. The interface gracefully handles small screens and adapts to different orientations.

Linear, Accessible Ordering Flow

Complex workflows are reduced to the essential steps: browse categories → search or filter items → add to cart → review cart → enter delivery details → verify and send. Each step is clearly communicated with visual feedback and form validation. The flow avoids surprises and minimizes cognitive load.

Trust Through Transparency

Customers see exactly what they're ordering before sending, and owners receive accurate order details with item options and quantities. Price calculations include delivery fees and taxes, and the order confirmation shows the restaurant's name and volume hint. Differences between cart price and WhatsApp price are automatically explained.

Multi-Language, One Platform

Rather than building separate apps for English, French, and Arabic, a single codebase handles all languages with instant client-side switching. Translations are bundled with menu data, and the interface language is retained across page reloads. This reduces development overhead while maximizing accessibility.

Data Integrity as a First-Class Concern

Concurrent editing is prevented through optimistic locking with revision comparison. Duplicate link names are rejected. Orders are validated against the current menu state, ensuring price accuracy. Images are validated and stored with integrity checks.

Privacy-Focused

The system never stores credit card information— payments happen directly in WhatsApp with no connection to the platform. Customer contact details are only used for order processing and are deleted after a short retention period (configurable per restaurant). The privacy policy is prominently displayed and linked.

## Quick Start

### Prerequisites

- Node.js 20 or higher
- A PostgreSQL database (tested with Neon Serverless PostgreSQL)
- A WhatsApp Business phone number for order notifications

### Installation

1. Clone the repository and navigate to the project:

   ```bash
   git clone <repository-url>
   cd clickmenu
   ```

2. Create a `.env` file in the project root:

   ```bash
   cp .env.example .env
   ```

3. Configure your environment variables (see `.env.example`):

   ```env
   DATABASE_URL="postgresql://user:password@host:port/dbname"
   SITE_URL="https://your-restaurant.com"
   # Optional: Enable API rate limiting when deployed
   RATE_LIMIT_ENABLED="true"
   ```

4. Install dependencies:

   ```bash
   npm install
   ```

5. Set up the database schema:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

6. Start the development server:

   ```bash
   npm run dev
   ```

7. Open your browser and navigate to:

   - **Demo Café:** http://localhost:3000/menu
   - **Admin Dashboard:** http://localhost:3000/admin

### Running the Application

The application automatically serves the demo café at `/menu` and opens the admin dashboard at `/admin`. To configure a real restaurant:

1. Sign in to the admin dashboard
2. Access the "Your Restaurant" settings
3. Enter your restaurant name, address, hours, WhatsApp number
4. Add dishes, categories, and optional extras
5. Choose a link name for your customer menu
6. Generate and print QR codes or share the link with customers

### Development Scripts

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Run database migrations
npm run db:migrate

# Generate database migrations from schema changes
npm run db:generate

# Open Drizzle Studio for database GUI
npm run db:studio

# Run ESLint
npm run lint
```

## Technology Stack

### Core Framework

- **Next.js 16.4.6** with React 19 — Server and client components, App Router, API routes
- **TypeScript 5** — Static typing for type safety and better IDE support
- **Tailwind CSS 4.3.3** — Utility-first CSS with modern color customization
- **@radix-ui/themes 3.3.0** — Headless UI primitives with accessibility baked in

### Database & Storage

- **Drizzle ORM 0.45.4** — Type-safe SQL query builder with PostgreSQL support
- **@neondatabase/serverless 1.2.1** — Serverless PostgreSQL driver (cloud-native scaling)
- **Image storage** — Base64-encoded images stored in PostgreSQL (simple, serverless-friendly; plan to migrate to separate storage in future)

### Complementary Libraries

- **lucide-react** — Iconography for consistent visual language
- **react-hook-form** — Efficient form handling with validation
- **recharts** — Data visualization (future: sales analytics)
- **qrcode** — QR code generation for customer menus
- **cmdk** — Keyboard-first command palette (future)
- **vaul** — Drawer/modal components (mobile-first)

## Documentation Structure

This documentation suite is organized into three phases of increasing depth:

### Phase 1: Core Understanding
- **[README.md](./README.md)** — Project overview, business value, and quick start guide
- **[PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)** — Directory structure and responsibilities
- **[FILE_EXPLORER.md](./FILE_EXPLORER.md)** — Walkthrough of key files and their roles

### Phase 2: Architecture & Design
- **[ARCHITECTURE_AND_ADR.md](./ARCHITECTURE_AND_ADR.md)** — Architecture decisions, design patterns, and system diagrams
- **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** — Database schema, relationships, and data flow patterns

### Phase 3: APIs & Operations
- **[API_REFERENCE.md](./API_REFERENCE.md)** — Complete API endpoint documentation
- **[DEPLOYMENT_AND_RUNBOOK.md](./DEPLOYMENT_AND_RUNBOOK.md)** — CI/CD, deployment, and troubleshooting
- **[TESTING_STRATEGY.md](./TESTING_STRATEGY.md)** — Testing approach and coverage

## Getting Help

Before opening an issue, please:

1. Review the documentation in this folder
2. Check the [FAQ](./FAQ.md) (if present) for common questions
3. Examine the error messages in the browser console or terminal
4. Search existing issues for similar problems

If you need assistance, please provide:
- Your operating system and browser version
- Steps to reproduce the issue
- Relevant console errors or screenshots
- Your Next.js and Node.js versions (run `node --version` and output from `next --version`)

## Roadmap

**Currently Stabilized**
- Multi-language menu browsing and ordering
- Admin dashboard for restaurant menu management
- WhatsApp order integration
- QR code generation
- Order tracking by restaurant owners
- Customer privacy protections

**Future Improvements**
- Image storage separate from PostgreSQL (Cloudinary, S3)
- Customer accounts with order history
- Pre-order functionality for pickup times
- Analytics dashboard for restaurant owners
- Support for custom payment gateways
- Multi-location restaurant support
- Customer review system
- Event-based menu promotions

## License

Copyright © 2024-2026 ClickMenu. All rights reserved.

---

**Documentation Version:** 1.0.0
**Last Updated:** 2026-11-23