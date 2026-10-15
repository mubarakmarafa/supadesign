#pragma once

#include "SupatermSourceTextRunShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using SupatermSourceTextRunComponentDescriptor =
    ConcreteComponentDescriptor<SupatermSourceTextRunShadowNode>;

void SupatermSourceTextRunSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
