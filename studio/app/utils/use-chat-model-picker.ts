import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useModelCapabilitiesResolver } from "./model-capabilities";

export function useChatModelPicker<
  T extends { name: string; provider?: { providerName?: string } },
>(models: T[], beforeImageOpen?: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [imageOnly, setImageOnly] = useState(false);
  const capabilitiesForModel = useModelCapabilitiesResolver();
  const consumedIntent = useRef<string>();
  const beforeImageOpenRef = useRef(beforeImageOpen);
  beforeImageOpenRef.current = beforeImageOpen;
  const isChatRoute =
    location.pathname === Path.Chat || location.pathname === Path.Home;

  useEffect(() => {
    if (!isChatRoute) {
      setOpen(false);
      return;
    }
    if (
      location.state?.selectImageModel !== true ||
      consumedIntent.current === location.key
    ) {
      return;
    }

    consumedIntent.current = location.key;
    beforeImageOpenRef.current?.();
    setImageOnly(true);
    setOpen(true);
    // Replace only the consumed intent so back, reload and Strict Mode do not
    // reopen the picker, and unrelated route state keeps its original value.
    const remainingState = { ...location.state };
    delete remainingState.selectImageModel;
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        state: Object.keys(remainingState).length ? remainingState : null,
      },
    );
  }, [isChatRoute, location, navigate]);

  const pickerModels = useMemo(
    () =>
      imageOnly
        ? models.filter(
            (model) =>
              capabilitiesForModel(model.name, model.provider?.providerName)
                .category === "image",
          )
        : models,
    [imageOnly, models, capabilitiesForModel],
  );

  const openAll = useCallback(() => {
    setImageOnly(false);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return {
    open: isChatRoute && open,
    imageOnly,
    models: pickerModels,
    openAll,
    close,
  };
}
