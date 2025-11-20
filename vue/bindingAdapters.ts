import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createBindingLifecycle, type BindingLifecycleAdapterHooks } from "@voxcss/controller/bindingLifecycle";

export function useElementBindingAdapter<TOptions, TAdapter extends { sync(): void; destroy(): void }>(
  resolveOptions: () => TOptions | null,
  factory: (hooks: BindingLifecycleAdapterHooks<TOptions | null>) => TAdapter
) {
  const elementRef = ref<HTMLElement | null>(null);
  const lifecycle = createBindingLifecycle(factory);

  onMounted(() => {
    lifecycle.setElement(elementRef.value);
  });

  onBeforeUnmount(() => {
    lifecycle.destroy();
  });

  watch(
    () => resolveOptions(),
    (next) => {
      lifecycle.setOptions(next);
    },
    { deep: true, immediate: true }
  );

  watch(
    elementRef,
    (next) => {
      lifecycle.setElement(next);
    },
    { immediate: true }
  );

  return {
    elementRef
  };
}
