#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>

@interface SupatermSourceTextManager : RCTViewManager
@end

@implementation SupatermSourceTextManager

RCT_EXPORT_MODULE(SupatermSourceText)

- (UIView *)view {
  return [[UIView alloc] init];
}

@end

@interface SupatermSourceTextRunManager : RCTViewManager
@end

@implementation SupatermSourceTextRunManager

RCT_EXPORT_MODULE(SupatermSourceTextRun)

- (UIView *)view {
  return nil;
}

@end
