import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';

export default component$(() => {
  const online = useSignal<boolean>(true);
  useVisibleTask$(() => {
    online.value = navigator.onLine;
    const on = () => {
      online.value = true;
    };
    const off = () => {
      online.value = false;
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
  return (
    <div class={`fixed bottom-3 right-3 z-[100001] transition-opacity ${online.value ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <div class="alert alert-warning shadow-lg">
        <span>You’re offline — showing cached content</span>
      </div>
    </div>
  );
});


