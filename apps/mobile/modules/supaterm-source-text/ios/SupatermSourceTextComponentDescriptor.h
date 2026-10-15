#pragma once

#include "SupatermSourceTextShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using SupatermSourceTextComponentDescriptor =
    ConcreteComponentDescriptor<SupatermSourceTextShadowNode>;

void SupatermSourceTextSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
