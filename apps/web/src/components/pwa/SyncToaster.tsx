import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';

type EventMsg = { type: 'bg-sync:queued' | 'bg-sync:replayed'; queue?: string };

export default component$(() => {
  const visible = useSignal(false);
  const text = useSignal('');

  useVisibleTask$(() => {
    try {
      const bc = new BroadcastChannel('app-events');
      bc.onmessage = (ev: MessageEvent<EventMsg>) => {
        const data = ev.data || ({} as EventMsg);
        if (data?.type === 'bg-sync:queued') {
          text.value = 'You’re offline — action queued';
          visible.value = true;
          hideSoon();
        } else if (data?.type === 'bg-sync:replayed') {
          text.value = 'Queued actions sent';
          visible.value = true;
          hideSoon(2500);
        }
      };
    } catch {}
  });

  function hideSoon(delay = 1800) {
    setTimeout(() => { visible.value = false; }, delay);
  }

  return (
    <div class={`toast toast-end z-[100002] transition ${visible.value ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div class="alert alert-info">
        <span>{text.value}</span>
      </div>
    </div>
  );
});

