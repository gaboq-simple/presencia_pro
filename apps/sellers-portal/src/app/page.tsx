import { redirect } from 'next/navigation';

// Root route — the middleware handles auth redirects, but this explicit
// redirect covers the rare case where middleware doesn't match '/'.
export default function RootPage() {
  redirect('/dashboard');
}
