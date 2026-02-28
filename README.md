# Chess Results Wrapper

A clean, modern wrapper for Chess-Results.com pairings, built with Astro.

## Features

- **Modern UI**: Clean, responsive interface for viewing chess tournament pairings.
- **Carousel View**: Automatically cycles through pages of pairings, perfect for projector displays at tournaments.
- **Internationalization (i18n)**: Supports English and Portuguese (Portugal).
- **Configurable**: Easily change tournament ID, round, and language via the UI or URL parameters.

## Usage

### URL Parameters

You can configure the view using URL parameters:

- `tid`: Tournament ID (e.g., `1361358`)
- `round`: Round number (e.g., `1`)
- `lang`: Language ID
    - `1`: English (Default)
    - `10`: Portuguese (Portugal)
    - `2`: Spanish (UI only)
    - `0`: German (UI only)
    - `20`: French (UI only)

Example: `/?tid=1361358&round=1&lang=10`

### Development

1. Install dependencies:
   ```sh
   npm install
   ```

2. Start the development server:
   ```sh
   npm run dev
   ```

3. Build for production:
   ```sh
   npm run build
   ```

4. Preview the build:
   ```sh
   npm run preview
   ```

## License

MIT
