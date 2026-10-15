#pragma once

#include <react/renderer/components/SupatermSourceTextSpec/EventEmitters.h>
#include <react/renderer/components/SupatermSourceTextSpec/Props.h>
#include <react/renderer/components/SupatermSourceTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char SupatermSourceTextRunComponentName[];

using SupatermSourceTextRunShadowNode =
    ConcreteViewShadowNode<SupatermSourceTextRunComponentName, SupatermSourceTextRunProps,
                           SupatermSourceTextRunEventEmitter, SupatermSourceTextRunState>;
} // namespace facebook::react
