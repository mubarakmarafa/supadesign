#import "SupatermSourceTextRun.h"
#import <React/RCTFabricComponentsPlugins.h>
#import "SupatermSourceTextRunComponentDescriptor.h"
#import <react/renderer/components/SupatermSourceTextSpec/Props.h>
#import <react/renderer/components/SupatermSourceTextSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface SupatermSourceTextRun () <RCTSupatermSourceTextRunViewProtocol>

@end

@implementation SupatermSourceTextRun {
  NSString *_text;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      SupatermSourceTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps =
        std::make_shared<const SupatermSourceTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  const auto &oldViewProps =
      *std::static_pointer_cast<SupatermSourceTextRunProps const>(_props);
  const auto &newViewProps =
      *std::static_pointer_cast<SupatermSourceTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> SupatermSourceTextRunCls(void) {
  return SupatermSourceTextRun.class;
}

@end
